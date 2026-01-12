import type { InboundMessage, WAHAWebhookPayload, MessageSource } from '../../types/lead.js';
import { parseWAHAMessage, parseTelegramMessage, validateMessage } from '../message/message.parser.js';
import { handleInboundMessage } from '../message/message.handler.js';
import { markAsExisting } from '../lead/lead.service.js';
import { normalizeUserId } from '../../utils/normalize-user.js';
import { logger } from '../../infra/logger.js';

export interface InboundServiceResult {
  success: boolean;
  shouldReply: boolean;
  replyMessage?: string;
  error?: string;
}

/**
 * Process inbound WAHA (WhatsApp) webhook
 */
export async function processWAHAWebhook(
  payload: WAHAWebhookPayload
): Promise<InboundServiceResult> {
  logger.debug({ event: payload.event }, 'Processing WAHA webhook');

  // Parse message
  const message = parseWAHAMessage(payload);

  if (!message) {
    return { success: true, shouldReply: false };
  }

  // Validate message
  const validation = validateMessage(message);
  if (!validation.valid) {
    logger.debug({ reason: validation.reason }, 'Message validation failed');
    return { success: true, shouldReply: false };
  }

  // Handle message
  return handleInboundMessage(message);
}

/**
 * Process inbound Telegram webhook
 */
export async function processTelegramWebhook(
  update: unknown
): Promise<InboundServiceResult> {
  logger.debug('Processing Telegram webhook');

  // Parse message
  const message = parseTelegramMessage(update as import('../../types/lead.js').TelegramUpdate);

  if (!message) {
    return { success: true, shouldReply: false };
  }

  // Validate message
  const validation = validateMessage(message);
  if (!validation.valid) {
    logger.debug({ reason: validation.reason }, 'Message validation failed');
    return { success: true, shouldReply: false };
  }

  // Handle message
  return handleInboundMessage(message);
}

/**
 * Generic inbound message processor
 */
export async function processInboundMessage(
  source: MessageSource,
  rawPayload: unknown
): Promise<InboundServiceResult> {
  if (source === 'whatsapp') {
    return processWAHAWebhook(rawPayload as WAHAWebhookPayload);
  }

  if (source === 'telegram') {
    return processTelegramWebhook(rawPayload);
  }

  return {
    success: false,
    shouldReply: false,
    error: `Unknown source: ${source}`,
  };
}

/**
 * Process outgoing message webhook (when WE send message to someone)
 * This marks the user as EXISTING so bot won't respond to their replies
 */
export async function processOutgoingWebhook(
  payload: WAHAWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if this is an outgoing message (fromMe = true)
    const fromMe = payload.payload?.fromMe || payload.payload?._data?.key?.fromMe;
    if (!fromMe) {
      return { success: true }; // Not outgoing, ignore
    }

    // Get the recipient
    const rawRecipient = 
      payload.payload?.to ||
      payload.payload?._data?.key?.remoteJid ||
      payload.payload?.from;

    if (!rawRecipient) {
      return { success: true }; // No recipient found
    }

    // Normalize user ID
    const userId = normalizeUserId(rawRecipient, 'whatsapp');
    
    // Skip group chats
    if (userId.includes('@g.us')) {
      return { success: true };
    }

    logger.info({ userId }, 'Outgoing message detected - marking as EXISTING');

    // Mark this number as EXISTING so bot won't respond to their replies
    await markAsExisting(userId, 'whatsapp');

    return { success: true };
  } catch (error) {
    logger.error({ error }, 'Failed to process outgoing webhook');
    return { success: false, error: (error as Error).message };
  }
}
