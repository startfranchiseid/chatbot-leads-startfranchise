import { PoolClient } from 'pg';
import { withTransaction } from '../../infra/db.js';
import { acquireLockWithRetry, releaseLock } from '../../infra/redis.js';
import { addTelegramNotifyJob } from '../../infra/queue.js';
import { logger } from '../../infra/logger.js';
import {
  InboundMessage,
  Lead,
  LeadStates,
  MessageHandlerResult,
  EscalationInfo,
} from '../../types/lead.js';
import {
  getOrCreateLead,
  updateLeadState,
  addInteraction,
  incrementWarningCount,
  getLeadFormData,
  upsertFormData,
} from '../lead/lead.service.js';
import { shouldBotReply, getNextState } from '../lead/lead.state.js';
import {
  parseFormData,
  validateFormData,
  isFormSubmission,
  getMissingFieldsMessage,
} from '../lead/lead.validator.js';
import { checkIdempotency, markAsProcessed } from './idempotency.js';
import { detectIntent } from './message.parser.js';

// Bot Messages
const BOT_MESSAGES = {
  WELCOME: `Halo! 👋 Selamat datang di StartFranchise.

Kami membantu Anda menemukan peluang franchise terbaik.

Silakan pilih:
1️⃣ Saya ingin mencari franchise
2️⃣ Saya ingin mendaftarkan bisnis sebagai franchisor
3️⃣ Saya ingin bertanya tentang franchise`,

  CHOOSE_OPTION: `Terima kasih! Untuk melanjutkan, mohon isi data berikut:

📝 *Form Pendaftaran Lead*

Silakan kirim dalam format:
- Sumber info: [Dari mana Anda tahu kami? Instagram/Google/dll]
- Jenis bisnis: [F&B/Retail/Jasa/dll]
- Budget: [Perkiraan modal Anda]
- Rencana mulai: [Kapan rencana memulai?]

Contoh:
Sumber: Instagram
Bisnis: F&B kuliner
Budget: 100 juta
Mulai: 3 bulan lagi`,

  FORM_RECEIVED: `✅ Terima kasih! Data Anda sedang kami proses.

Tim kami akan segera menghubungi Anda untuk konsultasi lebih lanjut.

Jika ada pertanyaan, silakan chat langsung di sini.`,

  PARTNERSHIP: `Terima kasih atas minat Anda untuk mendaftarkan bisnis sebagai franchisor!

Tim partnership kami akan segera menghubungi Anda.

Mohon tunggu konfirmasi dari tim kami dalam 1x24 jam.`,

  QUESTION_RECEIVED: `Terima kasih atas pertanyaannya! 

Tim kami akan segera merespons pertanyaan Anda.

Mohon tunggu, kami akan membalas secepatnya.`,

  INVALID_OPTION: `Maaf, pilihan tidak valid. Silakan pilih:

1️⃣ Mencari franchise
2️⃣ Mendaftarkan bisnis sebagai franchisor
3️⃣ Bertanya tentang franchise`,

  ESCALATION_NOTICE: `Terima kasih atas kesabaran Anda.

Tim customer service kami akan segera menghubungi Anda secara langsung.

Mohon tunggu, kami akan membantu Anda secepatnya.`,
};

/**
 * Main message handler
 */
export async function handleInboundMessage(
  message: InboundMessage
): Promise<MessageHandlerResult> {
  const { source, messageId, userId, text } = message;

  // 1. Idempotency check
  const isDuplicate = await checkIdempotency(source, messageId);
  if (isDuplicate) {
    logger.info({ source, messageId }, 'Dropping duplicate message');
    return { success: true, shouldReply: false };
  }

  // 2. Acquire user lock
  const lockResult = await acquireLockWithRetry(userId);
  if (!lockResult.acquired) {
    logger.warn({ userId }, 'Failed to acquire lock - message will be retried');
    return { success: false, shouldReply: false, error: 'Lock acquisition failed' };
  }

  try {
    // 3. Process message within transaction
    const result = await withTransaction(async (client) => {
      return processMessage(client, message);
    });

    // 4. Mark message as processed
    await markAsProcessed(source, messageId);

    return result;
  } catch (error) {
    logger.error({ error, userId, messageId }, 'Failed to process message');
    return {
      success: false,
      shouldReply: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // 5. Release lock
    if (lockResult.lockValue) {
      await releaseLock(userId, lockResult.lockValue);
    }
  }
}

/**
 * Process message within transaction
 */
async function processMessage(
  client: PoolClient,
  message: InboundMessage
): Promise<MessageHandlerResult> {
  const { source, messageId, userId, text } = message;

  // Get or create lead
  const { lead, isNew } = await getOrCreateLead(userId, source);

  // Log interaction
  await addInteraction(lead.id, messageId, text, 'in', client);

  // Check if bot should reply
  if (!shouldBotReply(lead.state)) {
    logger.info({ leadId: lead.id, state: lead.state }, 'Bot reply suppressed for this state');
    return { success: true, shouldReply: false };
  }

  // Handle based on current state
  return handleByState(client, lead, message);
}

/**
 * Handle message based on lead state
 */
async function handleByState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage
): Promise<MessageHandlerResult> {
  const { text } = message;
  const intent = detectIntent(text);

  switch (lead.state) {
    case LeadStates.NEW:
      return handleNewState(client, lead, message, intent);

    case LeadStates.CHOOSE_OPTION:
      return handleChooseOptionState(client, lead, message, intent);

    case LeadStates.FORM_SENT:
    case LeadStates.FORM_IN_PROGRESS:
      return handleFormState(client, lead, message, intent);

    case LeadStates.FORM_COMPLETED:
      return handleCompletedState(client, lead, message, intent);

    case LeadStates.PARTNERSHIP:
      return handlePartnershipState(client, lead, message, intent);

    default:
      logger.warn({ state: lead.state }, 'Unknown lead state');
      return { success: true, shouldReply: false };
  }
}

/**
 * Handle NEW state
 */
async function handleNewState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  intent: string
): Promise<MessageHandlerResult> {
  // Transition to CHOOSE_OPTION
  await updateLeadState(lead.id, LeadStates.CHOOSE_OPTION, client);

  return {
    success: true,
    shouldReply: true,
    replyMessage: BOT_MESSAGES.WELCOME,
  };
}

/**
 * Handle CHOOSE_OPTION state
 */
async function handleChooseOptionState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  intent: string
): Promise<MessageHandlerResult> {
  const { text } = message;
  const trimmedText = text.trim();

  // Check for option selection
  if (trimmedText === '1') {
    // Want to find franchise - send form
    await updateLeadState(lead.id, LeadStates.FORM_SENT, client);
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.CHOOSE_OPTION,
    };
  }

  if (trimmedText === '2') {
    // Want to register as franchisor
    await updateLeadState(lead.id, LeadStates.PARTNERSHIP, client);
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.PARTNERSHIP,
    };
  }

  if (trimmedText === '3') {
    // Has questions - escalate
    await handleEscalation(client, lead, message, 'question');
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.QUESTION_RECEIVED,
    };
  }

  // Invalid option - increment warning
  const { shouldEscalate } = await incrementWarningCount(lead.id, client);

  if (shouldEscalate) {
    await handleEscalation(client, lead, message, 'max_warnings');
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.ESCALATION_NOTICE,
    };
  }

  return {
    success: true,
    shouldReply: true,
    replyMessage: BOT_MESSAGES.INVALID_OPTION,
  };
}

/**
 * Handle FORM_SENT and FORM_IN_PROGRESS states
 */
async function handleFormState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  intent: string
): Promise<MessageHandlerResult> {
  const { text } = message;

  // Transition to FORM_IN_PROGRESS if still in FORM_SENT
  if (lead.state === LeadStates.FORM_SENT) {
    await updateLeadState(lead.id, LeadStates.FORM_IN_PROGRESS, client);
  }

  // Get existing form data
  const existingFormData = await getLeadFormData(lead.id);

  // Parse form data from message
  const parsedData = parseFormData(text);

  // Validate form completeness
  const validation = validateFormData(parsedData, existingFormData || undefined);

  // Save parsed data
  await upsertFormData(lead.id, parsedData, client);

  if (validation.valid) {
    // Form complete - transition to FORM_COMPLETED
    await upsertFormData(lead.id, { completed: true }, client);
    await updateLeadState(lead.id, LeadStates.FORM_COMPLETED, client);

    // Queue sync to Google Sheets (async)
    // This happens outside the transaction
    logger.info({ leadId: lead.id }, 'Form completed - queuing sync');

    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.FORM_RECEIVED,
    };
  }

  // Form incomplete - increment warning
  const { shouldEscalate } = await incrementWarningCount(lead.id, client);

  if (shouldEscalate) {
    await handleEscalation(client, lead, message, 'max_warnings');
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.ESCALATION_NOTICE,
    };
  }

  // Return missing fields message
  return {
    success: true,
    shouldReply: true,
    replyMessage: getMissingFieldsMessage(validation.errors || []),
  };
}

/**
 * Handle FORM_COMPLETED state
 */
async function handleCompletedState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  intent: string
): Promise<MessageHandlerResult> {
  // User already submitted form - they might have questions
  // Escalate to human
  await handleEscalation(client, lead, message, 'post_form_contact');

  return {
    success: true,
    shouldReply: true,
    replyMessage: BOT_MESSAGES.QUESTION_RECEIVED,
  };
}

/**
 * Handle PARTNERSHIP state
 */
async function handlePartnershipState(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  intent: string
): Promise<MessageHandlerResult> {
  // Partnership lead sent another message - notify admin
  await handleEscalation(client, lead, message, 'partnership_followup');

  return {
    success: true,
    shouldReply: true,
    replyMessage: BOT_MESSAGES.QUESTION_RECEIVED,
  };
}

/**
 * Handle escalation to human admin
 */
async function handleEscalation(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  reason: string
): Promise<void> {
  // Update state to MANUAL_INTERVENTION
  try {
    await updateLeadState(lead.id, LeadStates.MANUAL_INTERVENTION, client);
  } catch (error) {
    // State might already be in MANUAL_INTERVENTION
    logger.debug({ leadId: lead.id, error }, 'State transition failed during escalation');
  }

  // Queue notification to admin
  const escalationInfo: EscalationInfo = {
    userId: lead.user_id,
    lastMessage: message.text,
    currentState: lead.state,
    warningCount: lead.warning_count,
    source: message.source,
    timestamp: new Date(),
  };

  await addTelegramNotifyJob({
    type: 'escalation',
    data: escalationInfo,
  });

  logger.info(
    { leadId: lead.id, userId: lead.user_id, reason },
    'Lead escalated to manual intervention'
  );
}
