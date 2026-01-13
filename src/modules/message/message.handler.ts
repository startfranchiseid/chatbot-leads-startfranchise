import { PoolClient } from 'pg';
import { withTransaction } from '../../infra/db.js';
import {
  acquireLockWithRetry,
  releaseLock,
  isUserInCooldown,
  setUserCooldown,
  addToPendingMessages,
  getPendingMessages,
  clearPendingMessages,
  setPendingLock,
  isPendingLockActive,
} from '../../infra/redis.js';
import {
  addTelegramNotifyJob,
  addSheetsSyncJob
} from '../../infra/queue.js';
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
1️⃣ Minat Franchise
2️⃣ Daftar Sebagai Franchisor
3️⃣ Keperluan lain / Kerja sama`,

  CHOOSE_OPTION: `Terima kasih! Agar kami dapat membantu merekomendasikan franchise yang paling tepat untuk Anda, mohon lengkapi info singkat berikut:
  
📝 *Info Calon Mitra*

Silakan copy template di bawah ini, isi data Anda, lalu kirim kembali:`,

  FORM_TEMPLATE: `Nama, Domisili: 
Sumber info: 
Jenis bisnis: 
Budget: 
Rencana mulai: `,

  FORM_RECEIVED: `✅ Terima kasih! Data Anda sudah kami terima.

Tim konsultan kami akan menganalisa kebutuhan Anda dan segera menghubungi Anda untuk memberikan rekomendasi franchise terbaik.

Jika ada pertanyaan tambahan, silakan chat langsung di sini.`,

  PARTNERSHIP: `Terima kasih atas minat Anda untuk mendaftarkan bisnis sebagai franchisor!

Tim partnership kami akan segera menghubungi Anda untuk diskusi lebih lanjut.

Mohon tunggu konfirmasi dari tim kami.`,

  QUESTION_RECEIVED: `Terima kasih! 

Tim kami akan segera merespons pesan Anda.

Mohon tunggu, kami akan membalas secepatnya.`,

  INVALID_OPTION: `Maaf, pilihan tidak valid. Silakan pilih:

1️⃣ Minat Franchise
2️⃣ Daftar Sebagai Franchisor
3️⃣ Keperluan lain / Kerja sama`,

  ESCALATION_NOTICE: `Terima kasih atas kesabaran Anda.

Tim customer service kami akan segera menghubungi Anda secara langsung.

Mohon tunggu, kami akan membantu Anda secepatnya.`,

  OTHER_NEEDS: `Terima kasih! 

Tim kami akan segera merespons pesan Anda.

Mohon tunggu, kami akan membalas secepatnya.`,
};

/**
 * Main message handler with anti-spam protection
 */
export async function handleInboundMessage(
  message: InboundMessage
): Promise<MessageHandlerResult> {
  const { source, messageId, userId, text } = message;

  // 1. Idempotency check - prevent duplicate message processing
  const isDuplicate = await checkIdempotency(source, messageId);
  if (isDuplicate) {
    logger.debug({ source, messageId }, 'Dropping duplicate message');
    return { success: true, shouldReply: false };
  }

  // 2. Mark as processed immediately to prevent double processing from message + message.any events
  await markAsProcessed(source, messageId);

  // 3. Check user cooldown (anti-spam)
  const inCooldown = await isUserInCooldown(userId);
  if (inCooldown) {
    logger.debug({ userId }, 'User in cooldown - queuing message');
    // Still log the interaction but don't respond
    try {
      await withTransaction(async (client) => {
        const { lead } = await getOrCreateLead(userId, source);
        await addInteraction(lead.id, messageId, text, 'in', client);
      });
    } catch (e) {
      logger.error({ error: e }, 'Failed to log interaction during cooldown');
    }
    return { success: true, shouldReply: false };
  }

  // 4. Acquire user lock
  const lockResult = await acquireLockWithRetry(userId);
  if (!lockResult.acquired) {
    logger.warn({ userId }, 'Failed to acquire lock - message will be retried');
    return { success: false, shouldReply: false, error: 'Lock acquisition failed' };
  }

  try {
    // 5. Process message within transaction
    const result = await withTransaction(async (client) => {
      return processMessage(client, message);
    });

    // 6. Set cooldown after successful response
    if (result.shouldReply) {
      await setUserCooldown(userId);
    }

    return result;
  } catch (error) {
    logger.error({ error, userId, messageId }, 'Failed to process message');
    return {
      success: false,
      shouldReply: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // 7. Release lock
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
      secondaryMessage: BOT_MESSAGES.FORM_TEMPLATE,
    };
  }

  if (trimmedText === '2') {
    // Want to register as franchisor
    await handleSpecialOption(client, lead, message, 'partnership_interest');
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.PARTNERSHIP,
    };
  }

  if (trimmedText === '3') {
    // Other needs
    await handleSpecialOption(client, lead, message, 'other_needs');
    return {
      success: true,
      shouldReply: true,
      replyMessage: BOT_MESSAGES.OTHER_NEEDS,
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
    // We do this despite being in a transaction - Redis operations are fast
    // and if DB fails, worst case we have a job that fails/retries
    await addSheetsSyncJob({
      leadId: lead.id,
      userId: lead.user_id,
      source: message.source,
      formData: validation.parsedData as any, // validation.parsedData is complete merged data
    });

    // Notify Admin about completed form
    await addTelegramNotifyJob({
      type: 'form_completed',
      data: {
        leadId: lead.id,
        userId: lead.user_id,
        formData: validation.parsedData as any,
      },
    });

    logger.info({ leadId: lead.id }, 'Form completed - sync job queued');

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

/**
 * Handle special options (2, 3, 4)
 */
async function handleSpecialOption(
  client: PoolClient,
  lead: Lead,
  message: InboundMessage,
  type: 'partnership_interest' | 'general_inquiry' | 'other_needs'
): Promise<void> {
  // Update state to MANUAL_INTERVENTION to stop bot
  try {
    await updateLeadState(lead.id, LeadStates.MANUAL_INTERVENTION, client);
  } catch (error) {
    logger.debug({ leadId: lead.id, error }, 'State transition failed during special option');
  }

  // Queue notification
  const escalationInfo: EscalationInfo = {
    userId: lead.user_id,
    lastMessage: message.text,
    currentState: lead.state,
    warningCount: lead.warning_count,
    source: message.source,
    timestamp: new Date(),
  };

  await addTelegramNotifyJob({
    type,
    data: escalationInfo,
  });

  logger.info(
    { leadId: lead.id, userId: lead.user_id, type },
    'Lead selected special option'
  );
}

