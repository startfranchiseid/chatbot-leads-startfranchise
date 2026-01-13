import type { InboundMessage, WAHAWebhookPayload, TelegramUpdate, MessageSource } from '../../types/lead.js';
import { normalizeUserId, isGroupChat, isBroadcastMessage, isWhatsAppLid } from '../../utils/normalize-user.js';
import { logger } from '../../infra/logger.js';

/**
 * Extract the best user ID from WAHA payload
 * Priority: remoteJidAlt (phone) > from (could be LID)
 * Also returns the LID if available for cross-reference
 */
function extractWAHAUserIds(payload: WAHAWebhookPayload): { userId: string; lid: string | null; phone: string | null } | null {
  const messagePayload = payload.payload;
  if (!messagePayload) return null;

  const from = messagePayload.from;
  const remoteJid = messagePayload._data?.key?.remoteJid;
  const remoteJidAlt = messagePayload._data?.key?.remoteJidAlt;

  let userId = from;
  let lid: string | null = null;
  let phone: string | null = null;

  // 1. Try to find LID
  if (from && from.includes('@lid')) {
    lid = from;
  } else if (remoteJidAlt && remoteJidAlt.includes('@lid')) {
    lid = remoteJidAlt;
  }

  // 2. Try to find Phone
  if (from && (from.includes('@s.whatsapp.net') || from.includes('@c.us'))) {
    phone = from.replace('@c.us', '@s.whatsapp.net');
  } else if (remoteJid && remoteJid.includes('@s.whatsapp.net')) {
    phone = remoteJid;
  } else if (remoteJidAlt && remoteJidAlt.includes('@s.whatsapp.net')) {
    phone = remoteJidAlt;
  }

  // 3. Determine primary userId (Prefer Phone > LID)
  if (phone) {
    userId = phone;
  } else if (lid) {
    userId = lid;
  }

  if (!userId) return null;

  return { userId, lid, phone };
}

/**
 * Parse WAHA webhook payload to normalized InboundMessage
 * Handles both @lid and @s.whatsapp.net formats
 */
export function parseWAHAMessage(payload: WAHAWebhookPayload): InboundMessage | null {
  try {
    const { event, payload: messagePayload } = payload;

    // Only process message events
    if (event !== 'message' && event !== 'message.any') {
      logger.debug({ event }, 'Ignoring non-message WAHA event');
      return null;
    }

    if (!messagePayload) {
      logger.debug('No message payload in WAHA webhook');
      return null;
    }

    const {
      id,
      from,
      body,
      fromMe,
      timestamp,
    } = messagePayload;

    // Get chatId - could be in different places
    const chatId = messagePayload.chatId || messagePayload._data?.key?.remoteJid || from;

    // Reject self messages? NO, allow them to create leads as EXISTING
    // but ensure we extract the correct ID (recipient)

    // Reject group messages
    const isGroup = messagePayload.isGroup || (chatId && chatId.endsWith('@g.us'));
    if (isGroup || isGroupChat(chatId || '', 'whatsapp')) {
      logger.debug({ messageId: id, chatId }, 'Ignoring group message');
      return null;
    }

    // Reject broadcast/status messages
    if (isBroadcastMessage(chatId || '', 'whatsapp')) {
      logger.debug({ messageId: id, chatId }, 'Ignoring broadcast message');
      return null;
    }

    // Extract user IDs (handles @lid and @s.whatsapp.net)
    // If fromMe (outgoing), the userId is the RECIPIENT (to)
    let userIds;
    if (fromMe || messagePayload._data?.key?.fromMe) {
      // Outgoing: userId is the recipient
      const recipient = messagePayload.to || messagePayload._data?.key?.remoteJid;
      userIds = { userId: recipient, lid: null, phone: null };
      // Note: lid/phone extraction for outgoing might need more logic if 'to' is also @lid
      // For now assume 'to' is correct format or can be normalized
    } else {
      userIds = extractWAHAUserIds(payload);
    }

    if (!userIds || !userIds.userId) {
      logger.debug({ messageId: id }, 'Could not extract user ID');
      return null;
    }

    // Normalize user ID for database lookup
    const normalizedUserId = normalizeUserId(userIds.userId, 'whatsapp');

    logger.debug({
      messageId: id,
      from,
      userId: normalizedUserId,
      lid: userIds.lid,
      phone: userIds.phone,
    }, 'Parsed WAHA message');

    return {
      source: 'whatsapp',
      messageId: id,
      userId: normalizedUserId,
      text: body || '',
      fromMe: false,
      isGroup: false,
      isBroadcast: false,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      rawPayload: payload,
      // Store extra info for LID handling
      metadata: {
        lid: userIds.lid,
        phone: userIds.phone,
        pushName: messagePayload._data?.pushName || payload.me?.pushName,
      },
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
