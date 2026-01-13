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
  markAsExisting,
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
import { getMessage } from './message.config.js';


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
  const { source, messageId, userId, text, fromMe } = message;

  // 0. Handle Outgoing Messages (We chatted first)
  if (fromMe) {
    logger.info({ userId }, 'Processing outgoing message - Marking lead as EXISTING');
    // Create lead as EXISTING (or update if NEW) -> Bot will NOT trigger
    const lead = await markAsExisting(userId, source);
    // Log interaction
    await addInteraction(lead.id, messageId, text, 'out', client);
    return { success: true, shouldReply: false };
  }

  // 1. Get or create lead
  logger.debug({ userId }, 'Handling inbound message - Step 1: Get/Create Lead');

  // Extract pushName safely (casting if needed or checking metadata)
  const pushName = (message as any).pushName || message.metadata?.pushName;

  const result = await getOrCreateLead(userId, message.source, {
    metadata: message.metadata,
    pushName: pushName
  });
  const { lead } = result;

  logger.info({ leadId: lead.id, state: lead.state, userId }, 'Lead retrieved/created');

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
    replyMessage: await getMessage('WELCOME'),
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
      replyMessage: await getMessage('CHOOSE_OPTION'),
      secondaryMessage: await getMessage('FORM_TEMPLATE'),
    };
  }

  if (trimmedText === '2') {
    // Want to register as franchisor
    await handleSpecialOption(client, lead, message, 'partnership_interest');
    return {
      success: true,
      shouldReply: true,
      replyMessage: await getMessage('PARTNERSHIP'),
    };
  }

  if (trimmedText === '3') {
    // Other needs
    await handleSpecialOption(client, lead, message, 'other_needs');
    return {
      success: true,
      shouldReply: true,
      replyMessage: await getMessage('OTHER_NEEDS'),
    };
  }

  // Invalid option - increment warning
  const { shouldEscalate } = await incrementWarningCount(lead.id, client);

  if (shouldEscalate) {
    await handleEscalation(client, lead, message, 'max_warnings');
    return {
      success: true,
      shouldReply: true,
      replyMessage: await getMessage('ESCALATION_NOTICE'),
    };
  }

  return {
    success: true,
    shouldReply: true,
    replyMessage: await getMessage('INVALID_OPTION'),
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
      replyMessage: await getMessage('FORM_RECEIVED'),
    };
  }

  // Form incomplete - increment warning
  const { shouldEscalate } = await incrementWarningCount(lead.id, client);

  if (shouldEscalate) {
    await handleEscalation(client, lead, message, 'max_warnings');
    return {
      success: true,
      shouldReply: true,
      replyMessage: await getMessage('ESCALATION_NOTICE'),
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
    replyMessage: await getMessage('QUESTION_RECEIVED'),
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
    replyMessage: await getMessage('QUESTION_RECEIVED'),
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
    reason,
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

