import { addTelegramNotifyJob } from '../../infra/queue.js';
import { logger } from '../../infra/logger.js';
import type { Lead, EscalationInfo } from '../../types/lead.js';

const MAX_WARNINGS = 3;

/**
 * Check if lead should be escalated based on warning count
 */
export function shouldEscalate(warningCount: number): boolean {
  return warningCount >= MAX_WARNINGS;
}

/**
 * Build escalation info for admin notification
 */
export function buildEscalationInfo(
  lead: Lead,
  lastMessage: string,
  reason?: string
): EscalationInfo {
  return {
    userId: lead.user_id,
    lastMessage,
    currentState: lead.state,
    warningCount: lead.warning_count,
    source: lead.source,
    timestamp: new Date(),
    reason,
  };
}

/**
 * Send escalation notification to admin
 */
export async function notifyAdminEscalation(
  escalationInfo: EscalationInfo
): Promise<void> {
  try {
    await addTelegramNotifyJob({
      type: 'escalation',
      data: escalationInfo,
    });

    logger.info(
      { userId: escalationInfo.userId, warningCount: escalationInfo.warningCount, reason: escalationInfo.reason },
      'Admin escalation notification queued'
    );
  } catch (error) {
    logger.error({ error, escalationInfo }, 'Failed to queue escalation notification');
    throw error;
  }
}

/**
 * Get warning message for user
 */
export function getWarningMessage(warningCount: number): string {
  const remaining = MAX_WARNINGS - warningCount;

  if (remaining <= 0) {
    return 'Tim kami akan segera menghubungi Anda secara langsung untuk membantu.';
  }

  if (remaining === 1) {
    return `⚠️ Mohon ikuti format yang diberikan. Ini adalah peringatan terakhir sebelum kami mengalihkan ke tim customer service.`;
  }

  return `⚠️ Format tidak sesuai. Mohon ikuti contoh format yang diberikan. (Kesempatan tersisa: ${remaining})`;
}

/**
 * Build admin escalation message
 */
export function buildAdminMessage(escalationInfo: EscalationInfo): string {
  return `🚨 *ESCALATION ALERT*

*Reason:* ${escalationInfo.reason || 'Manual Escalation'}
*User ID:* \`${escalationInfo.userId}\`
*Source:* ${escalationInfo.source.toUpperCase()}
*Current State:* ${escalationInfo.currentState}
*Warning Count:* ${escalationInfo.warningCount}
*Timestamp:* ${new Date(escalationInfo.timestamp).toISOString()}

*Last Message:*
${escalationInfo.lastMessage}

---
Please respond to this user manually.`;
}
