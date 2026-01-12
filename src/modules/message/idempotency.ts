import { isMessageProcessed, markMessageProcessed } from '../../infra/redis.js';
import { logger } from '../../infra/logger.js';
import type { MessageSource } from '../../types/lead.js';

/**
 * Idempotency service for duplicate message protection
 * 
 * Key format: processed:{source}:{message_id}
 * TTL: 24 hours (configurable via env)
 */

/**
 * Check if message has already been processed
 */
export async function checkIdempotency(
  source: MessageSource,
  messageId: string
): Promise<boolean> {
  try {
    const isProcessed = await isMessageProcessed(source, messageId);
    
    if (isProcessed) {
      logger.debug(
        { source, messageId },
        'Duplicate message detected - already processed'
      );
    }
    
    return isProcessed;
  } catch (error) {
    // Log error but don't block processing if Redis is temporarily unavailable
    logger.error(
      { source, messageId, error },
      'Failed to check idempotency - proceeding with caution'
    );
    return false; // Allow processing but log the issue
  }
}

/**
 * Mark message as processed
 */
export async function markAsProcessed(
  source: MessageSource,
  messageId: string
): Promise<void> {
  try {
    await markMessageProcessed(source, messageId);
  } catch (error) {
    // Log error - message might be processed twice in rare failure cases
    logger.error(
      { source, messageId, error },
      'Failed to mark message as processed'
    );
  }
}

/**
 * Generate idempotency key
 */
export function getIdempotencyKey(source: MessageSource, messageId: string): string {
  return `processed:${source}:${messageId}`;
}
