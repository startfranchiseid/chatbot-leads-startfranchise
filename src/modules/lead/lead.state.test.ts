import { describe, it, expect, vi } from 'vitest';
import {
    isValidTransition,
    attemptTransition,
    getNextState,
    shouldBotReply,
    requiresFormData,
    getAllStates,
    isValidState,
} from './lead.state.js';

// Mock the logger to prevent actual logging during tests
vi.mock('../../infra/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('lead.state', () => {
    describe('isValidTransition', () => {
        describe('valid transitions', () => {
            it('NEW → CHOOSE_OPTION', () => {
                expect(isValidTransition('NEW', 'CHOOSE_OPTION')).toBe(true);
            });

            it('NEW → MANUAL_INTERVENTION', () => {
                expect(isValidTransition('NEW', 'MANUAL_INTERVENTION')).toBe(true);
            });

            it('CHOOSE_OPTION → FORM_SENT', () => {
                expect(isValidTransition('CHOOSE_OPTION', 'FORM_SENT')).toBe(true);
            });

            it('CHOOSE_OPTION → PARTNERSHIP', () => {
                expect(isValidTransition('CHOOSE_OPTION', 'PARTNERSHIP')).toBe(true);
            });

            it('FORM_SENT → FORM_IN_PROGRESS', () => {
                expect(isValidTransition('FORM_SENT', 'FORM_IN_PROGRESS')).toBe(true);
            });

            it('FORM_IN_PROGRESS → FORM_COMPLETED', () => {
                expect(isValidTransition('FORM_IN_PROGRESS', 'FORM_COMPLETED')).toBe(true);
            });

            it('FORM_IN_PROGRESS → FORM_SENT (retry)', () => {
                expect(isValidTransition('FORM_IN_PROGRESS', 'FORM_SENT')).toBe(true);
            });

            it('MANUAL_INTERVENTION → NEW (admin reset)', () => {
                expect(isValidTransition('MANUAL_INTERVENTION', 'NEW')).toBe(true);
            });

            it('MANUAL_INTERVENTION → CHOOSE_OPTION', () => {
                expect(isValidTransition('MANUAL_INTERVENTION', 'CHOOSE_OPTION')).toBe(true);
            });
        });

        describe('invalid transitions', () => {
            it('NEW → FORM_COMPLETED (skip states)', () => {
                expect(isValidTransition('NEW', 'FORM_COMPLETED')).toBe(false);
            });

            it('FORM_COMPLETED → NEW', () => {
                expect(isValidTransition('FORM_COMPLETED', 'NEW')).toBe(false);
            });

            it('PARTNERSHIP → NEW', () => {
                expect(isValidTransition('PARTNERSHIP', 'NEW')).toBe(false);
            });

            it('EXISTING → any state (no bot response for existing)', () => {
                expect(isValidTransition('EXISTING', 'CHOOSE_OPTION')).toBe(false);
                expect(isValidTransition('EXISTING', 'NEW')).toBe(false);
            });
        });
    });

    describe('attemptTransition', () => {
        it('should return success for valid transition', () => {
            const result = attemptTransition('NEW', 'CHOOSE_OPTION');
            expect(result.success).toBe(true);
            expect(result.previousState).toBe('NEW');
            expect(result.newState).toBe('CHOOSE_OPTION');
            expect(result.error).toBeUndefined();
        });

        it('should return failure for invalid transition', () => {
            const result = attemptTransition('NEW', 'FORM_COMPLETED');
            expect(result.success).toBe(false);
            expect(result.previousState).toBe('NEW');
            expect(result.newState).toBe('NEW'); // State unchanged
            expect(result.error).toBeDefined();
        });
    });

    describe('getNextState', () => {
        it('should return CHOOSE_OPTION for select_option from NEW', () => {
            expect(getNextState('NEW', 'select_option')).toBe('CHOOSE_OPTION');
        });

        it('should return FORM_SENT for select_option from CHOOSE_OPTION', () => {
            expect(getNextState('CHOOSE_OPTION', 'select_option')).toBe('FORM_SENT');
        });

        it('should return FORM_IN_PROGRESS for submit_form from FORM_SENT', () => {
            expect(getNextState('FORM_SENT', 'submit_form')).toBe('FORM_IN_PROGRESS');
        });

        it('should return FORM_COMPLETED for complete_form from FORM_IN_PROGRESS', () => {
            expect(getNextState('FORM_IN_PROGRESS', 'complete_form')).toBe('FORM_COMPLETED');
        });

        it('should return MANUAL_INTERVENTION for escalate from any state', () => {
            expect(getNextState('NEW', 'escalate')).toBe('MANUAL_INTERVENTION');
            expect(getNextState('FORM_SENT', 'escalate')).toBe('MANUAL_INTERVENTION');
        });

        it('should return PARTNERSHIP for select_partnership from CHOOSE_OPTION', () => {
            expect(getNextState('CHOOSE_OPTION', 'select_partnership')).toBe('PARTNERSHIP');
        });

        it('should return null for invalid action from state', () => {
            expect(getNextState('FORM_COMPLETED', 'select_option')).toBeNull();
        });
    });

    describe('shouldBotReply', () => {
        it('should return true for NEW state', () => {
            expect(shouldBotReply('NEW')).toBe(true);
        });

        it('should return true for CHOOSE_OPTION state', () => {
            expect(shouldBotReply('CHOOSE_OPTION')).toBe(true);
        });

        it('should return true for FORM_SENT state', () => {
            expect(shouldBotReply('FORM_SENT')).toBe(true);
        });

        it('should return true for FORM_IN_PROGRESS state', () => {
            expect(shouldBotReply('FORM_IN_PROGRESS')).toBe(true);
        });

        it('should return false for EXISTING state', () => {
            expect(shouldBotReply('EXISTING')).toBe(false);
        });

        it('should return false for MANUAL_INTERVENTION state', () => {
            expect(shouldBotReply('MANUAL_INTERVENTION')).toBe(false);
        });

        it('should return false for FORM_COMPLETED state', () => {
            expect(shouldBotReply('FORM_COMPLETED')).toBe(false);
        });

        it('should return false for PARTNERSHIP state', () => {
            expect(shouldBotReply('PARTNERSHIP')).toBe(false);
        });
    });

    describe('requiresFormData', () => {
        it('should return true for FORM_IN_PROGRESS', () => {
            expect(requiresFormData('FORM_IN_PROGRESS')).toBe(true);
        });

        it('should return true for FORM_COMPLETED', () => {
            expect(requiresFormData('FORM_COMPLETED')).toBe(true);
        });

        it('should return false for other states', () => {
            expect(requiresFormData('NEW')).toBe(false);
            expect(requiresFormData('CHOOSE_OPTION')).toBe(false);
            expect(requiresFormData('FORM_SENT')).toBe(false);
        });
    });

    describe('getAllStates', () => {
        it('should return all valid states', () => {
            const states = getAllStates();
            expect(states).toContain('NEW');
            expect(states).toContain('EXISTING');
            expect(states).toContain('CHOOSE_OPTION');
            expect(states).toContain('FORM_SENT');
            expect(states).toContain('FORM_IN_PROGRESS');
            expect(states).toContain('FORM_COMPLETED');
            expect(states).toContain('MANUAL_INTERVENTION');
            expect(states).toContain('PARTNERSHIP');
        });
    });

    describe('isValidState', () => {
        it('should return true for valid states', () => {
            expect(isValidState('NEW')).toBe(true);
            expect(isValidState('FORM_COMPLETED')).toBe(true);
        });

        it('should return false for invalid states', () => {
            expect(isValidState('INVALID')).toBe(false);
            expect(isValidState('random')).toBe(false);
        });
    });
});
