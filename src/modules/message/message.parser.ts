import type { InboundMessage, WAHAWebhookPayload, TelegramUpdate, MessageSource } from '../../types/lead.js';
import { normalizeUserId, isGroupChat, isBroadcastMessage } from '../../utils/normalize-user.js';
import { logger } from '../../infra/logger.js';

/**
 * Parse WAHA webhook payload to normalized InboundMessage
 */
export function parseWAHAMessage(payload: WAHAWebhookPayload): InboundMessage | null {
  try {
    const { event, payload: messagePayload } = payload;

    // Only process message events
    if (event !== 'message') {
      logger.debug({ event }, 'Ignoring non-message WAHA event');
      return null;
    }

    const {
      id,
      from,
      body,
      fromMe,
      isGroup,
      timestamp,
      chatId,
    } = messagePayload;

    // Reject self messages
    if (fromMe) {
      logger.debug({ messageId: id }, 'Ignoring self message');
      return null;
    }

    // Reject group messages
    if (isGroup || isGroupChat(chatId, 'whatsapp')) {
      logger.debug({ messageId: id, chatId }, 'Ignoring group message');
      return null;
    }

    // Reject broadcast/status messages
    if (isBroadcastMessage(chatId, 'whatsapp')) {
      logger.debug({ messageId: id, chatId }, 'Ignoring broadcast message');
      return null;
    }

    // Normalize user ID
    const userId = normalizeUserId(from, 'whatsapp');

    return {
      source: 'whatsapp',
      messageId: id,
      userId,
      text: body || '',
      fromMe: false,
      isGroup: false,
      isBroadcast: false,
      timestamp,
      rawPayload: payload,
    };
  } catch (error) {
    logger.error({ error, payload }, 'Failed to parse WAHA message');
    return null;
  }
}

/**
 * Parse Telegram update to normalized InboundMessage
 */
export function parseTelegramMessage(update: TelegramUpdate): InboundMessage | null {
  try {
    const { message } = update;

    // Only process messages with text
    if (!message || !message.text) {
      logger.debug({ updateId: update.update_id }, 'Ignoring Telegram update without text');
      return null;
    }

    const { message_id, from, chat, date, text } = message;

    // Reject bot messages
    if (from.is_bot) {
      logger.debug({ messageId: message_id }, 'Ignoring bot message');
      return null;
    }

    // Reject group/channel messages
    if (chat.type !== 'private') {
      logger.debug({ messageId: message_id, chatType: chat.type }, 'Ignoring non-private chat');
      return null;
    }

    // Normalize user ID
    const userId = normalizeUserId(from.id.toString(), 'telegram');

    return {
      source: 'telegram',
      messageId: message_id.toString(),
      userId,
      text,
      fromMe: false,
      isGroup: false,
      isBroadcast: false,
      timestamp: date,
      rawPayload: update,
    };
  } catch (error) {
    logger.error({ error, update }, 'Failed to parse Telegram message');
    return null;
  }
}

/**
 * Validate that message meets basic requirements
 */
export function validateMessage(message: InboundMessage): { valid: boolean; reason?: string } {
  // Check message ID
  if (!message.messageId) {
    return { valid: false, reason: 'Missing message ID' };
  }

  // Check user ID
  if (!message.userId) {
    return { valid: false, reason: 'Missing user ID' };
  }

  // Check for self message
  if (message.fromMe) {
    return { valid: false, reason: 'Self message' };
  }

  // Check for group
  if (message.isGroup) {
    return { valid: false, reason: 'Group message' };
  }

  // Check for broadcast
  if (message.isBroadcast) {
    return { valid: false, reason: 'Broadcast message' };
  }

  // Empty text is allowed (user might send media only)
  // but we should flag it
  if (!message.text || message.text.trim() === '') {
    return { valid: false, reason: 'Empty message text' };
  }

  return { valid: true };
}

/**
 * Extract command from message (for Telegram-style commands)
 */
export function extractCommand(text: string): { command: string | null; args: string } {
  const trimmed = text.trim();
  
  // Check for command pattern: /command or /command@botname
  const commandMatch = trimmed.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?\s*(.*)/);
  
  if (commandMatch) {
    return {
      command: commandMatch[1]!.toLowerCase(),
      args: commandMatch[2] || '',
    };
  }

  return { command: null, args: text };
}

/**
 * Detect user intent from message
 */
export function detectIntent(text: string): 'greeting' | 'form_response' | 'question' | 'option_select' | 'unknown' {
  const normalizedText = text.toLowerCase().trim();

  // Greeting patterns
  const greetingPatterns = [
    /^(hi|hello|halo|hai|selamat|salam|hey|hei)/i,
    /^(pagi|siang|sore|malam)/i,
  ];

  for (const pattern of greetingPatterns) {
    if (pattern.test(normalizedText)) {
      return 'greeting';
    }
  }

  // Option selection (numbered responses)
  if (/^[1-9]$/.test(normalizedText)) {
    return 'option_select';
  }

  // Question patterns
  const questionPatterns = [
    /\?$/,
    /^(apa|bagaimana|gimana|berapa|kapan|dimana|siapa|mengapa|kenapa)/i,
    /^(what|how|when|where|who|why)/i,
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(normalizedText)) {
      return 'question';
    }
  }

  // Form response detection (has multiple fields or keywords)
  const formKeywords = [
    'sumber', 'source', 'dari',
    'bisnis', 'business', 'usaha',
    'budget', 'modal', 'anggaran',
    'mulai', 'start', 'kapan', 'timeline',
  ];

  const keywordMatches = formKeywords.filter(kw => normalizedText.includes(kw));
  if (keywordMatches.length >= 2 || normalizedText.includes('\n')) {
    return 'form_response';
  }

  return 'unknown';
}
