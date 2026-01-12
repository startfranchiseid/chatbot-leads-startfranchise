import type { InboundMessage, WAHAWebhookPayload, MessageSource } from '../../types/lead.js';
import { parseWAHAMessage, parseTelegramMessage, validateMessage } from '../message/message.parser.js';
import { handleInboundMessage } from '../message/message.handler.js';
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
