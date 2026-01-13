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
/**
 * Send form completed notification
 */
async function sendFormCompletedNotification(data: { leadId: string; userId: string; formData?: any }): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!adminChatId) {
    return;
  }

  // Format Date: "Senin, 13 Januari 2026 10:30 WIB"
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const dateTime = `${dateStr} ${timeStr}`;

  // Format WhatsApp Link
  let phone = data.userId.replace(/@.*/, '');
  if (phone.startsWith('0')) phone = '62' + phone.substring(1);
  const waLink = `wa.me/${phone}`;

  // Format Data Fields
  let dataFields = '';
  if (data.formData) {
    const fd = data.formData;
    if (fd.biodata) dataFields += `- Nama & Domisili: ${fd.biodata}\n`;
    if (fd.source_info) dataFields += `- Sumber: ${fd.source_info}\n`;
    if (fd.business_type) dataFields += `- Bisnis: ${fd.business_type}\n`;
    if (fd.budget) dataFields += `- Budget: ${fd.budget}\n`;
    if (fd.start_plan) dataFields += `- Mulai: ${fd.start_plan}\n`;
  }

  const message = `✅ *Form Completed*
📅 ${dateTime}

👤 ${data.formData?.biodata || '-'}
📱 ${waLink}

📝 *Data Lead:*
${dataFields}
ID: \`${data.leadId}\``;

  await sendTelegramMessage(adminChatId, message);
}

/**
 * Send special notification (Opt 2, 3, 4)
 */
async function sendSpecialNotification(header: string, data: EscalationInfo): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!adminChatId) {
    return;
  }

  // Format WhatsApp Link
  let phone = data.userId.replace(/@.*/, '');
  if (phone.startsWith('0')) phone = '62' + phone.substring(1);
  const waLink = `https://wa.me/${phone}`;

  const message = `${header}

👤 User: \`${data.userId}\`
📱 Chat: [Klik untuk Chat](${waLink})
📅 Time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}

💬 *Last Message:*
"${data.lastMessage || '-'}"`;

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
        await sendFormCompletedNotification(data as { leadId: string; userId: string; formData?: any });
        break;

      case 'partnership_interest':
        await sendSpecialNotification('🤝 *PARTNERSHIP INTEREST*', data as EscalationInfo);
        break;

      case 'general_inquiry':
        await sendSpecialNotification('❓ *GENERAL INQUIRY*', data as EscalationInfo);
        break;

      case 'other_needs':
        await sendSpecialNotification('📢 *OTHER NEEDS / COOPERATION*', data as EscalationInfo);
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
