import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processWAHAWebhook, processOutgoingWebhook } from './inbound.service.js';
import { query } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import type { WAHAWebhookPayload } from '../../types/lead.js';

/**
 * Check if chat is a group chat
 */
function isGroupChat(payload: WAHAWebhookPayload): boolean {
  const chatId = payload.payload?.chatId ||
    payload.payload?._data?.key?.remoteJid ||
    payload.payload?.from || '';

  // WhatsApp groups end with @g.us
  if (chatId.endsWith('@g.us')) {
    return true;
  }

  // Check isGroup flag
  if (payload.payload?.isGroup) {
    return true;
  }

  // Check if participant exists (indicates group message)
  if (payload.payload?._data?.key?.participant) {
    return true;
  }

  return false;
}

/**
 * Check if message is broadcast/status
 */
function isBroadcastOrStatus(payload: WAHAWebhookPayload): boolean {
  const chatId = payload.payload?.chatId ||
    payload.payload?._data?.key?.remoteJid ||
    payload.payload?.from || '';

  return chatId.includes('@broadcast') || chatId.includes('status@');
}

// Reply to WhatsApp via WAHA API
async function sendWAHAReply(chatId: string, message: string): Promise<void> {
  // NEVER send to groups
  if (chatId.endsWith('@g.us')) {
    logger.warn({ chatId }, 'Attempted to send to group - blocked');
    return;
  }

  const wahaUrl = process.env.WAHA_API_URL || 'http://localhost:3001';
  const sessionName = process.env.WAHA_SESSION_NAME || 'default';
  const apiKey = process.env.WAHA_API_KEY || '';

  try {
    const response = await fetch(`${wahaUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
        text: message,
        session: sessionName,
      }),
    });

    if (!response.ok) {
      throw new Error(`WAHA API error: ${response.status}`);
    }

    logger.debug({ chatId }, 'WAHA reply sent');
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to send WAHA reply');
    throw error;
  }
}

// Register WAHA routes
export async function wahaController(fastify: FastifyInstance): Promise<void> {
  // Health check for WAHA webhook
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'waha-webhook' };
  });

  // WAHA Webhook endpoint
  fastify.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      const rawPayload = request.body; // 2. Log Raw Webhook (for debugging/audit) & into Database
      const payload = rawPayload as WAHAWebhookPayload;

      logger.info({ payload: rawPayload }, '📦 WAHA WEBHOOK RAW PAYLOAD');

      try {
        // Fire and forget db log to not block processing
        query(
          `INSERT INTO webhook_logs (source, event_type, payload, status) VALUES ($1, $2, $3, $4)`,
          ['waha', payload.event || 'unknown', JSON.stringify(rawPayload), 'received']
        ).catch((e: unknown) => logger.error({ error: e }, 'Failed to log webhook to DB'));
      } catch (e) {
        // ignore
      }

      // Check session webhook status
      const sessionName = payload.session || 'default';
      const { getSessionByName, updateSessionLastSeen } = await import('../waha/session.service.js');
      const session = await getSessionByName(sessionName);

      // Update last seen timestamp
      if (session) {
        updateSessionLastSeen(sessionName).catch(() => { });
      }

      // If session not found or webhook disabled, ignore
      if (!session) {
        logger.warn({ sessionName }, 'WAHA session not found in database');
        return reply.status(200).send({ success: true, type: 'session_not_found' });
      }

      if (!session.webhook_enabled) {
        logger.info({ sessionName }, 'WAHA webhook disabled for this session');
        return reply.status(200).send({ success: true, type: 'webhook_disabled' });
      }

      // Handle outgoing messages from message.any (when WE send first)
      // This must happen BEFORE we filter out non-message events
      if (payload.event === 'message.any') {
        const isOutgoing = payload.payload?.fromMe || payload.payload?._data?.key?.fromMe;

        if (isOutgoing) {
          // Skip groups and broadcasts
          if (!isGroupChat(payload) && !isBroadcastOrStatus(payload)) {
            logger.info({ event: payload.event, fromMe: true }, 'Processing outgoing message.any');
            await processOutgoingWebhook(payload);
          }
          return reply.status(200).send({ success: true, type: 'outgoing_any' });
        }

        // Ignore incoming message.any (will be handled by message event)
        logger.debug({ event: payload.event }, 'Ignoring incoming message.any');
        return reply.status(200).send({ success: true, type: 'ignored' });
      }

      // Only process 'message' event for INCOMING messages
      if (payload.event !== 'message') {
        logger.debug({ event: payload.event }, 'Ignoring non-message event');
        return reply.status(200).send({ success: true, type: 'ignored' });
      }

      // ===== EARLY FILTERS - Before any processing =====

      // 1. Ignore GROUP messages completely
      if (isGroupChat(payload)) {
        logger.debug({
          chatId: payload.payload?.chatId || payload.payload?.from
        }, 'Ignoring group message');
        return reply.status(200).send({ success: true, type: 'group_ignored' });
      }

      // 2. Ignore broadcast/status messages
      if (isBroadcastOrStatus(payload)) {
        logger.debug({
          chatId: payload.payload?.chatId || payload.payload?.from
        }, 'Ignoring broadcast/status message');
        return reply.status(200).send({ success: true, type: 'broadcast_ignored' });
      }

      // Validate webhook secret if configured
      const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
      if (webhookSecret) {
        const providedSecret = request.headers['x-webhook-secret'];
        if (providedSecret !== webhookSecret) {
          logger.warn('Invalid webhook secret');
          return reply.status(401).send({ error: 'Unauthorized' });
        }
      }

      // Check if this is an outgoing message (we sent it)
      const isOutgoing = payload.payload?.fromMe || payload.payload?._data?.key?.fromMe;

      if (isOutgoing) {
        // When WE send a message to someone, mark them as EXISTING
        // So bot won't respond when they reply
        await processOutgoingWebhook(payload);
        return reply.status(200).send({ success: true, type: 'outgoing' });
      }

      // Process incoming message
      const result = await processWAHAWebhook(payload);

      // Send reply if needed (NEVER to groups)
      if (result.shouldReply && result.replyMessage && payload.payload?.from) {
        // Get the best chat ID for reply (prefer phone over LID)
        const replyTo = payload.payload._data?.key?.remoteJidAlt || payload.payload.from;

        // Double-check: never send to group
        if (!replyTo.endsWith('@g.us')) {
          // Don't await - send async for faster response
          sendWAHAReply(replyTo, result.replyMessage).then(async () => {
            // Send secondary reply if exists (for copyable template)
            if (result.secondaryMessage) {
              // Small delay to ensure order
              await new Promise(resolve => setTimeout(resolve, 500));
              await sendWAHAReply(replyTo, result.secondaryMessage!);
            }
          }).catch((err) => {
            logger.error({ err }, 'Failed to send WAHA reply');
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info({ duration, success: result.success }, 'WAHA webhook processed');

      // Always return 200 quickly to acknowledge webhook
      return reply.status(200).send({ success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({
        err: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration
      }, 'WAHA webhook error');

      // Still return 200 to prevent webhook retry storms
      return reply.status(200).send({ success: false });
    }
  });
}
