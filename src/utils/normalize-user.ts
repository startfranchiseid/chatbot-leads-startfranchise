/**
 * Normalize user ID from different platforms to consistent format
 * WhatsApp: Remove @c.us, @lid suffixes
 * Telegram: Use chat_id as string
 */
export function normalizeUserId(rawId: string, source: 'whatsapp' | 'telegram'): string {
  if (source === 'whatsapp') {
    // Remove WhatsApp suffixes: @c.us, @lid, @s.whatsapp.net, @g.us
    let normalized = rawId
      .replace(/@c\.us$/i, '')
      .replace(/@lid$/i, '')
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/@g\.us$/i, '');

    // Remove any remaining @ suffix
    const atIndex = normalized.indexOf('@');
    if (atIndex !== -1) {
      normalized = normalized.substring(0, atIndex);
    }

    // Ensure only digits remain for phone numbers
    return normalized.replace(/[^\d]/g, '');
  }

  if (source === 'telegram') {
    // Telegram uses numeric chat IDs
    return rawId.toString();
  }

  return rawId;
}

/**
 * Check if the chat ID represents a group
 */
export function isGroupChat(chatId: string, source: 'whatsapp' | 'telegram'): boolean {
  if (source === 'whatsapp') {
    // WhatsApp groups end with @g.us
    return chatId.endsWith('@g.us');
  }

  if (source === 'telegram') {
    // Telegram groups have negative IDs
    const numericId = parseInt(chatId);
    return numericId < 0;
  }

  return false;
}

/**
 * Check if message is a broadcast/status message
 */
export function isBroadcastMessage(chatId: string, source: 'whatsapp' | 'telegram'): boolean {
  if (source === 'whatsapp') {
    // WhatsApp status/broadcast
    return chatId.includes('status@broadcast') || chatId.includes('@broadcast');
  }

  // Telegram channels
  if (source === 'telegram') {
    // Telegram channels typically have specific patterns
    // This is handled by chat.type in the Telegram API
    return false;
  }

  return false;
}
