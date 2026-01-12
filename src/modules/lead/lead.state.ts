import { LeadState, LeadStates, StateTransitionResult } from '../../types/lead.js';
import { logger } from '../../infra/logger.js';

/**
 * Lead State Machine - Valid Transitions
 * 
 * NEW → CHOOSE_OPTION
 * EXISTING → (no transitions, bot does not respond)
 * CHOOSE_OPTION → FORM_SENT
 * CHOOSE_OPTION → PARTNERSHIP
 * FORM_SENT → FORM_IN_PROGRESS
 * FORM_IN_PROGRESS → FORM_COMPLETED
 * FORM_IN_PROGRESS → FORM_SENT (retry form)
 * ANY → MANUAL_INTERVENTION (escalation)
 */

// Define valid state transitions
const validTransitions: Record<LeadState, LeadState[]> = {
  [LeadStates.NEW]: [LeadStates.CHOOSE_OPTION, LeadStates.MANUAL_INTERVENTION],
  [LeadStates.EXISTING]: [], // No bot response - nomor lama
  [LeadStates.CHOOSE_OPTION]: [
    LeadStates.FORM_SENT,
    LeadStates.PARTNERSHIP,
    LeadStates.MANUAL_INTERVENTION,
  ],
  [LeadStates.FORM_SENT]: [
    LeadStates.FORM_IN_PROGRESS,
    LeadStates.MANUAL_INTERVENTION,
  ],
  [LeadStates.FORM_IN_PROGRESS]: [
    LeadStates.FORM_COMPLETED,
    LeadStates.FORM_SENT, // Allow retry
    LeadStates.MANUAL_INTERVENTION,
  ],
  [LeadStates.FORM_COMPLETED]: [
    LeadStates.MANUAL_INTERVENTION,
    LeadStates.PARTNERSHIP,
  ],
  [LeadStates.MANUAL_INTERVENTION]: [
    // Only admin can change from this state
    LeadStates.NEW,
    LeadStates.CHOOSE_OPTION,
    LeadStates.FORM_SENT,
    LeadStates.PARTNERSHIP,
  ],
  [LeadStates.PARTNERSHIP]: [LeadStates.MANUAL_INTERVENTION],
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: LeadState, to: LeadState): boolean {
  const allowedTransitions = validTransitions[from];
  if (!allowedTransitions) {
    return false;
  }
  return allowedTransitions.includes(to);
}

/**
 * Attempt to transition state
 */
export function attemptTransition(
  currentState: LeadState,
  targetState: LeadState
): StateTransitionResult {
  const isValid = isValidTransition(currentState, targetState);

  if (!isValid) {
    logger.warn(
      { currentState, targetState },
      'Invalid state transition attempted'
    );
    return {
      success: false,
      previousState: currentState,
      newState: currentState,
      error: `Invalid transition from ${currentState} to ${targetState}`,
    };
  }

  logger.info({ from: currentState, to: targetState }, 'State transition');
  return {
    success: true,
    previousState: currentState,
    newState: targetState,
  };
}

/**
 * Get next expected state based on current state and user action
 */
export function getNextState(
  currentState: LeadState,
  action: 'select_option' | 'submit_form' | 'complete_form' | 'escalate' | 'select_partnership'
): LeadState | null {
  switch (action) {
    case 'select_option':
      if (currentState === LeadStates.NEW) {
        return LeadStates.CHOOSE_OPTION;
      }
      if (currentState === LeadStates.CHOOSE_OPTION) {
        return LeadStates.FORM_SENT;
      }
      break;

    case 'submit_form':
      if (currentState === LeadStates.FORM_SENT) {
        return LeadStates.FORM_IN_PROGRESS;
      }
      break;

    case 'complete_form':
      if (currentState === LeadStates.FORM_IN_PROGRESS) {
        return LeadStates.FORM_COMPLETED;
      }
      break;

    case 'escalate':
      return LeadStates.MANUAL_INTERVENTION;

    case 'select_partnership':
      if (currentState === LeadStates.CHOOSE_OPTION || currentState === LeadStates.FORM_COMPLETED) {
        return LeadStates.PARTNERSHIP;
      }
      break;
  }

  return null;
}

/**
 * Check if user is in a state that should not receive bot replies
 */
export function shouldBotReply(state: LeadState): boolean {
  // Don't reply to:
  // - EXISTING: nomor lama yang sudah pernah chat / kita chat duluan
  // - MANUAL_INTERVENTION: sedang dihandle admin
  // - FORM_COMPLETED: sudah selesai
  // - PARTNERSHIP: sudah jadi partner
  const noReplyStates: LeadState[] = [
    LeadStates.EXISTING,
    LeadStates.MANUAL_INTERVENTION,
    LeadStates.FORM_COMPLETED,
    LeadStates.PARTNERSHIP,
  ];
  
  return !noReplyStates.includes(state);
}

/**
 * Check if state requires form data
 */
export function requiresFormData(state: LeadState): boolean {
  return (
    state === LeadStates.FORM_IN_PROGRESS ||
    state === LeadStates.FORM_COMPLETED
  );
}

/**
 * Get all valid states
 */
export function getAllStates(): LeadState[] {
  return Object.values(LeadStates);
}

/**
 * Validate state string
 */
export function isValidState(state: string): state is LeadState {
  return getAllStates().includes(state as LeadState);
}
