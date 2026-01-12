import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processTelegramWebhook } from './inbound.service.js';
import { logger } from '../../infra/logger.js';
import type { TelegramUpdate } from '../../types/lead.js';

// Telegram Bot API URL
const getTelegramApiUrl = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  return `https://api.telegram.org/bot${token}`;
};

// Send message via Telegram Bot API
async function sendTelegramReply(chatId: string | number, message: string): Promise<void> {
  try {
    const response = await fetch(`${getTelegramApiUrl()}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
    }

    logger.debug({ chatId }, 'Telegram reply sent');
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to send Telegram reply');
    throw error;
  }
}

// Register Telegram routes
export async function telegramController(fastify: FastifyInstance): Promise<void> {
  // Health check for Telegram webhook
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'telegram-webhook' };
  });

  // Telegram Webhook endpoint
  fastify.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      const update = request.body as TelegramUpdate;

      // Process the webhook
      const result = await processTelegramWebhook(update);

      // Send reply if needed
      if (result.shouldReply && result.replyMessage && update.message?.chat?.id) {
        // Don't await - send async for faster response
        sendTelegramReply(update.message.chat.id, result.replyMessage).catch((err) => {
          logger.error({ err }, 'Failed to send Telegram reply');
        });
      }

      const duration = Date.now() - startTime;
      logger.info({ duration, success: result.success }, 'Telegram webhook processed');

      // Return 200 quickly to acknowledge webhook
      return reply.status(200).send({ success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({ error, duration }, 'Telegram webhook error');

      // Return 200 to prevent webhook retry storms
      return reply.status(200).send({ success: false });
    }
  });

  // Set webhook endpoint (for initial setup)
  fastify.post('/set-webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { url } = request.body as { url: string };

      if (!url) {
        return reply.status(400).send({ error: 'URL is required' });
      }

      const response = await fetch(`${getTelegramApiUrl()}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: `${url}/api/telegram/webhook`,
          allowed_updates: ['message'],
        }),
      });

      const result = await response.json();
      return reply.send(result);
    } catch (error) {
      logger.error({ error }, 'Failed to set Telegram webhook');
      return reply.status(500).send({ error: 'Failed to set webhook' });
    }
  });

  // Get webhook info
  fastify.get('/webhook-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${getTelegramApiUrl()}/getWebhookInfo`);
      const result = await response.json();
      return reply.send(result);
    } catch (error) {
      logger.error({ error }, 'Failed to get Telegram webhook info');
      return reply.status(500).send({ error: 'Failed to get webhook info' });
    }
  });
}
