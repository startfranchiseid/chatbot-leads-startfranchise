import { Job } from 'bullmq';
import { logger } from '../../infra/logger.js';
import type { TelegramNotifyJobData } from '../../infra/queue.js';
import type { EscalationInfo } from '../../types/lead.js';
import { buildAdminMessage } from '../warning/warning.service.js';

// Telegram Bot API URL
function getTelegramApiUrl(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  return `https://api.telegram.org/bot${token}`;
}

/**
 * Send message to Telegram
 */
async function sendTelegramMessage(chatId: string | number, message: string): Promise<void> {
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
}

/**
 * Send escalation notification to admin
 */
async function sendEscalationNotification(data: EscalationInfo): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!adminChatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not configured - skipping escalation notification');
    return;
  }

  const message = buildAdminMessage(data);
  await sendTelegramMessage(adminChatId, message);

  logger.info({ userId: data.userId }, 'Escalation notification sent to admin');
}

/**
 * Send new lead notification
 */
async function sendNewLeadNotification(data: { leadId: string; userId: string }): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!adminChatId) {
    return;
  }

  const message = `📥 *New Lead*\n\nLead ID: \`${data.leadId}\`\nUser ID: \`${data.userId}\``;
  await sendTelegramMessage(adminChatId, message);
}

/**
 * Send form completed notification
 */
async function sendFormCompletedNotification(data: { leadId: string; userId: string }): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!adminChatId) {
    return;
  }

  const message = `✅ *Form Completed*\n\nLead ID: \`${data.leadId}\`\nUser ID: \`${data.userId}\`\n\nData has been synced to Google Sheets.`;
  await sendTelegramMessage(adminChatId, message);
}

/**
 * Worker processor for Telegram notifications
 */
export async function telegramWorkerProcessor(job: Job<TelegramNotifyJobData>): Promise<void> {
  const { type, data } = job.data;

  logger.info({ jobId: job.id, type }, 'Processing Telegram notification');

  try {
    switch (type) {
      case 'escalation':
        await sendEscalationNotification(data as EscalationInfo);
        break;

      case 'new_lead':
        await sendNewLeadNotification(data as { leadId: string; userId: string });
        break;

      case 'form_completed':
        await sendFormCompletedNotification(data as { leadId: string; userId: string });
        break;

      default:
        logger.warn({ type }, 'Unknown notification type');
    }

    logger.info({ jobId: job.id, type }, 'Telegram notification sent');
  } catch (error) {
    logger.error({ error, jobId: job.id, type }, 'Telegram notification failed');
    throw error; // Let BullMQ handle retry
  }
}
