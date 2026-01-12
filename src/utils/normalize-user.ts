/**
 * Check if the user ID is a WhatsApp LID (Linked Device ID) format
 * LID format: <numbers>@lid (e.g., 212188648214761@lid)
 */
export function isWhatsAppLid(rawId: string): boolean {
  return rawId.endsWith('@lid');
}

/**
 * Normalize user ID from different platforms to consistent format
 * 
 * WhatsApp formats:
 * - Phone: 6281234567890@s.whatsapp.net → 6281234567890@s.whatsapp.net
 * - LID: 212188648214761@lid → 212188648214761@lid (preserved for lookup)
 * - Group: 123@g.us → skip
 * - Status: status@broadcast → skip
 * 
 * Telegram: Use chat_id as string
 * 
 * Note: We now preserve the full format for proper database lookups
 */
export function normalizeUserId(rawId: string, source: 'whatsapp' | 'telegram'): string {
  if (source === 'whatsapp') {
    // For WhatsApp, preserve the full format for database lookup
    // This allows us to check both user_id and whatsapp_lid columns
    
    // If it's a @lid format, keep it as-is for LID lookup
    if (rawId.endsWith('@lid')) {
      return rawId;
    }
    
    // If it's a @s.whatsapp.net format, keep it as-is
    if (rawId.endsWith('@s.whatsapp.net')) {
      return rawId;
    }
    
    // If it's @c.us (older format), convert to @s.whatsapp.net
    if (rawId.endsWith('@c.us')) {
      const phone = rawId.replace(/@c\.us$/i, '');
      return `${phone}@s.whatsapp.net`;
    }
    
    // If no suffix, add @s.whatsapp.net
    if (!rawId.includes('@')) {
      const cleanPhone = rawId.replace(/[^\d]/g, '');
      if (cleanPhone.length >= 10) {
        return `${cleanPhone}@s.whatsapp.net`;
      }
    }
    
    // Return as-is for other cases
    return rawId;
  }

  if (source === 'telegram') {
    // Telegram uses numeric chat IDs
    return rawId.toString();
  }

  return rawId;
}

/**
 * Extract phone number from WhatsApp user ID (if available)
 * Returns null for @lid format since phone is unknown
 */
export function extractPhoneNumber(userId: string): string | null {
  // LID format doesn't contain phone number
  if (userId.endsWith('@lid')) {
    return null;
  }
  
  // Extract from @s.whatsapp.net or @c.us format
  const match = userId.match(/^(\d+)@/);
  if (match && match[1]) {
    return match[1];
  }
  
  // If pure numbers, return as-is
  if (/^\d+$/.test(userId)) {
    return userId;
  }
  
  return null;
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
