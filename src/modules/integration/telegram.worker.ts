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
 * Get all admin chat IDs (comma-separated in env)
 */
function getAdminChatIds(): string[] {
  const rawIds = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  return rawIds
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
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
 * Send message to ALL admin chat IDs
 */
async function sendToAllAdmins(message: string): Promise<void> {
  const adminIds = getAdminChatIds();

  if (adminIds.length === 0) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not configured - skipping notification');
    return;
  }

  // Send to all admins in parallel
  const results = await Promise.allSettled(
    adminIds.map(id => sendTelegramMessage(id, message))
  );

  // Log any failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error({ chatId: adminIds[index], error: result.reason }, 'Failed to send to admin');
    }
  });

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  logger.info({ total: adminIds.length, success: successCount }, 'Notification sent to admins');
}

/**
 * Escape Markdown special characters
 * Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Send escalation notification to admin
 */
async function sendEscalationNotification(data: EscalationInfo): Promise<void> {
  // Format WhatsApp Link
  let phone = data.userId.replace(/@.*/, '');
  if (phone.startsWith('0')) phone = '62' + phone.substring(1);
  const waLink = `https://wa.me/${phone}`;

  // Map reasons to human readable text
  let humanReason = data.reason || 'Manual Escalation';
  if (humanReason === 'max_warnings') humanReason = 'Salah Input 3x';
  if (humanReason === 'post_form_contact') humanReason = 'Tanya Setelah Form';
  if (humanReason === 'partnership_followup') humanReason = 'Follow-up Partnership';

  // Map state to human readable text
  let humanState = data.currentState as string;
  if (humanState === 'CHOOSE_OPTION') humanState = 'Pilih Opsi';
  if (humanState === 'FORM_IN_PROGRESS') humanState = 'Sedang Isi Form';
  if (humanState === 'FORM_SENT') humanState = 'Form Terkirim';
  if (humanState === 'FORM_COMPLETED') humanState = 'Form Selesai';
  if (humanState === 'MANUAL_INTERVENTION') humanState = 'Butuh Admin';

  // Escape dynamic data
  const reason = escapeMarkdown(humanReason);
  const userId = escapeMarkdown(data.userId.replace('@s.whatsapp.net', ''));
  const lastMessage = escapeMarkdown(data.lastMessage || '-');
  const state = escapeMarkdown(humanState);

  const message = `🚨 *BUTUH RESPON MANUAL* (Escalation)

*Alasan:* ${reason}
*User:* \`${userId}\`
*Status:* ${state}
*Warning:* ${data.warningCount}
📅 Waktu: ${escapeMarkdown(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))}

📱 Chat: [Klik untuk Chat](${waLink})

*Pesan Terakhir:*
${lastMessage}`;

  await sendToAllAdmins(message);

  logger.info({ userId: data.userId }, 'Escalation notification sent to admin');
}

/**
 * Send new lead notification
 */
async function sendNewLeadNotification(data: { leadId: string; userId: string }): Promise<void> {
  const userId = data.userId.replace('@s.whatsapp.net', '');
  const message = `📥 *Lead Baru Masuk*\n\nUser: \`${escapeMarkdown(userId)}\``;
  await sendToAllAdmins(message);
}

/**
 * Send form completed notification
 */
async function sendFormCompletedNotification(data: { leadId: string; userId: string; formData?: any }): Promise<void> {
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

  const message = `✅ *Form Data Masuk*
📅 ${escapeMarkdown(dateTime)}

👤 ${escapeMarkdown(data.formData?.biodata || '-')}
📱 ${waLink}

📝 *Data Lead:*
${escapeMarkdown(dataFields)}
ID: \`${escapeMarkdown(data.leadId)}\``;

  await sendToAllAdmins(message);
}

/**
 * Send special notification (Opt 2, 3, 4)
 */
async function sendSpecialNotification(header: string, data: EscalationInfo): Promise<void> {
  // Format WhatsApp Link
  let phone = data.userId.replace(/@.*/, '');
  if (phone.startsWith('0')) phone = '62' + phone.substring(1);
  const waLink = `https://wa.me/${phone}`;

  const userId = escapeMarkdown(data.userId.replace('@s.whatsapp.net', ''));
  const lastMessage = escapeMarkdown(data.lastMessage || '-');

  const message = `${header}

👤 User: \`${userId}\`
📱 Chat: [Klik untuk Chat](${waLink})
📅 Waktu: ${escapeMarkdown(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))}

💬 *Pesan Terakhir:*
"${lastMessage}"`;

  await sendToAllAdmins(message);
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
        await sendSpecialNotification('🤝 *MINAT JADI FRANCHISOR*', data as EscalationInfo);
        break;

      case 'general_inquiry':
        await sendSpecialNotification('❓ *PERTANYAAN UMUM*', data as EscalationInfo);
        break;

      case 'other_needs':
        await sendSpecialNotification('📢 *KEPERLUAN LAIN / KERJA SAMA*', data as EscalationInfo);
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
