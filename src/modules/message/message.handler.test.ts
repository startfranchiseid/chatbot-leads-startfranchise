import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InboundMessage, Lead, MessageHandlerResult } from '../../types/lead.js';

// Mock all external dependencies
const mockCheckIdempotency = vi.fn();
const mockMarkAsProcessed = vi.fn();
const mockAcquireLockWithRetry = vi.fn();
const mockReleaseLock = vi.fn();
const mockIsUserInCooldown = vi.fn();
const mockSetUserCooldown = vi.fn();
const mockWithTransaction = vi.fn();
const mockGetOrCreateLead = vi.fn();
const mockUpdateLeadState = vi.fn();
const mockAddInteraction = vi.fn();
const mockIncrementWarningCount = vi.fn();
const mockGetLeadFormData = vi.fn();
const mockUpsertFormData = vi.fn();
const mockAddTelegramNotifyJob = vi.fn();

vi.mock('./idempotency.js', () => ({
    checkIdempotency: (...args: any[]) => mockCheckIdempotency(...args),
    markAsProcessed: (...args: any[]) => mockMarkAsProcessed(...args),
}));

vi.mock('../../infra/redis.js', () => ({
    acquireLockWithRetry: (...args: any[]) => mockAcquireLockWithRetry(...args),
    releaseLock: (...args: any[]) => mockReleaseLock(...args),
    isUserInCooldown: (...args: any[]) => mockIsUserInCooldown(...args),
    setUserCooldown: (...args: any[]) => mockSetUserCooldown(...args),
    addToPendingMessages: vi.fn(),
    getPendingMessages: vi.fn(),
    clearPendingMessages: vi.fn(),
    setPendingLock: vi.fn(),
    isPendingLockActive: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
    withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../infra/queue.js', () => ({
    addTelegramNotifyJob: (...args: any[]) => mockAddTelegramNotifyJob(...args),
}));

vi.mock('../lead/lead.service.js', () => ({
    getOrCreateLead: (...args: any[]) => mockGetOrCreateLead(...args),
    updateLeadState: (...args: any[]) => mockUpdateLeadState(...args),
    addInteraction: (...args: any[]) => mockAddInteraction(...args),
    incrementWarningCount: (...args: any[]) => mockIncrementWarningCount(...args),
    getLeadFormData: (...args: any[]) => mockGetLeadFormData(...args),
    upsertFormData: (...args: any[]) => mockUpsertFormData(...args),
}));

vi.mock('../../infra/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Import the actual handler
import { handleInboundMessage } from './message.handler.js';

describe('message.handler E2E', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default successful mocks
        mockCheckIdempotency.mockResolvedValue(false); // Not duplicate
        mockMarkAsProcessed.mockResolvedValue(undefined);
        mockAcquireLockWithRetry.mockResolvedValue({ acquired: true, lockValue: 'lock-123' });
        mockReleaseLock.mockResolvedValue(true);
        mockIsUserInCooldown.mockResolvedValue(false); // Not in cooldown
        mockSetUserCooldown.mockResolvedValue(undefined);
        mockAddInteraction.mockResolvedValue(undefined);
        mockUpdateLeadState.mockResolvedValue(undefined);
        mockAddTelegramNotifyJob.mockResolvedValue(undefined);
    });

    const createMessage = (text: string, userId = '6281234567890@s.whatsapp.net'): InboundMessage => ({
        source: 'whatsapp',
        messageId: `msg-${Date.now()}`,
        userId,
        text,
        fromMe: false,
        isGroup: false,
        isBroadcast: false,
        timestamp: Math.floor(Date.now() / 1000),
        rawPayload: {},
    });

    const createLead = (state: string, warningCount = 0): Lead => ({
        id: 'lead-123',
        user_id: '6281234567890@s.whatsapp.net',
        source: 'whatsapp',
        state: state as any,
        warning_count: warningCount,
        created_at: new Date(),
        updated_at: new Date(),
    });

    describe('New User Flow', () => {
        it('should send welcome message to new user', async () => {
            const message = createMessage('Halo');
            const lead = createLead('NEW');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: true });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('Selamat datang');
            expect(mockUpdateLeadState).toHaveBeenCalledWith('lead-123', 'CHOOSE_OPTION', expect.anything());
        });

        it('should transition NEW → CHOOSE_OPTION → FORM_SENT', async () => {
            const message = createMessage('1');
            const lead = createLead('CHOOSE_OPTION');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('Form Pendaftaran');
            expect(mockUpdateLeadState).toHaveBeenCalledWith('lead-123', 'FORM_SENT', expect.anything());
        });
    });

    describe('Form Submission Flow', () => {
        it('should accept complete form and complete flow', async () => {
            const formMessage = `Sumber: Instagram
Bisnis: F&B
Budget: 100 juta
Mulai: 3 bulan lagi`;
            const message = createMessage(formMessage);
            const lead = createLead('FORM_SENT');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                mockGetLeadFormData.mockResolvedValue(null);
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('Terima kasih');
            expect(mockUpdateLeadState).toHaveBeenCalledWith('lead-123', 'FORM_COMPLETED', expect.anything());
        });

        it('should request missing fields for incomplete form', async () => {
            const message = createMessage('Sumber: Instagram');
            const lead = createLead('FORM_IN_PROGRESS');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                mockGetLeadFormData.mockResolvedValue({ source_info: 'Instagram' });
                mockIncrementWarningCount.mockResolvedValue({ shouldEscalate: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('belum lengkap');
        });
    });

    describe('Partnership Flow', () => {
        it('should handle partnership selection (option 2)', async () => {
            const message = createMessage('2');
            const lead = createLead('CHOOSE_OPTION');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('franchisor');
            expect(mockUpdateLeadState).toHaveBeenCalledWith('lead-123', 'PARTNERSHIP', expect.anything());
        });
    });

    describe('Escalation Flow', () => {
        it('should escalate after 3 invalid inputs', async () => {
            const message = createMessage('invalid input');
            const lead = createLead('CHOOSE_OPTION', 2);

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                mockIncrementWarningCount.mockResolvedValue({ shouldEscalate: true });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(result.replyMessage).toContain('customer service');
            expect(mockAddTelegramNotifyJob).toHaveBeenCalled();
        });

        it('should escalate question selection (option 3)', async () => {
            const message = createMessage('3');
            const lead = createLead('CHOOSE_OPTION');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(true);
            expect(mockAddTelegramNotifyJob).toHaveBeenCalled();
        });
    });

    describe('Anti-Spam & Duplicate Prevention', () => {
        it('should drop duplicate messages', async () => {
            mockCheckIdempotency.mockResolvedValue(true); // Duplicate!

            const message = createMessage('Hello');
            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(false);
            expect(mockWithTransaction).not.toHaveBeenCalled();
        });

        it('should skip reply for user in cooldown', async () => {
            mockIsUserInCooldown.mockResolvedValue(true);

            const message = createMessage('Hello');
            const lead = createLead('NEW');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(false);
        });

        it('should fail if lock cannot be acquired', async () => {
            mockAcquireLockWithRetry.mockResolvedValue({ acquired: false });
            mockIsUserInCooldown.mockResolvedValue(false);

            const message = createMessage('Hello');
            const result = await handleInboundMessage(message);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Lock');
        });
    });

    describe('No-Reply States', () => {
        it('should not reply to EXISTING state', async () => {
            const message = createMessage('Hello');
            const lead = createLead('EXISTING');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(false);
        });

        it('should not reply to MANUAL_INTERVENTION state', async () => {
            const message = createMessage('Hello');
            const lead = createLead('MANUAL_INTERVENTION');

            mockWithTransaction.mockImplementation(async (fn) => {
                mockGetOrCreateLead.mockResolvedValue({ lead, isNew: false });
                return fn({});
            });

            const result = await handleInboundMessage(message);

            expect(result.success).toBe(true);
            expect(result.shouldReply).toBe(false);
        });
    });

    describe('Lock Release', () => {
        it('should always release lock even on error', async () => {
            mockWithTransaction.mockRejectedValue(new Error('DB error'));

            const message = createMessage('Hello');
            const result = await handleInboundMessage(message);

            expect(result.success).toBe(false);
            expect(mockReleaseLock).toHaveBeenCalledWith(
                message.userId,
                'lock-123'
            );
        });
    });
});
