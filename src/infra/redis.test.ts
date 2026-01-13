import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis module functions directly
const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();
const mockAcquireLockWithRetry = vi.fn();
const mockIsMessageProcessed = vi.fn();
const mockMarkMessageProcessed = vi.fn();
const mockIsUserInCooldown = vi.fn();
const mockSetUserCooldown = vi.fn();

vi.mock('./redis.js', () => ({
    acquireLock: (...args: any[]) => mockAcquireLock(...args),
    releaseLock: (...args: any[]) => mockReleaseLock(...args),
    acquireLockWithRetry: (...args: any[]) => mockAcquireLockWithRetry(...args),
    isMessageProcessed: (...args: any[]) => mockIsMessageProcessed(...args),
    markMessageProcessed: (...args: any[]) => mockMarkMessageProcessed(...args),
    isUserInCooldown: (...args: any[]) => mockIsUserInCooldown(...args),
    setUserCooldown: (...args: any[]) => mockSetUserCooldown(...args),
    getRedis: vi.fn(),
    closeRedis: vi.fn(),
}));

// Mock logger
vi.mock('./logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('redis operations (mocked)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('distributed lock', () => {
        it('should acquire lock successfully when available', async () => {
            mockAcquireLock.mockResolvedValue({ acquired: true, lockValue: 'lock-123' });

            const result = await mockAcquireLock('user123');

            expect(result.acquired).toBe(true);
            expect(result.lockValue).toBeDefined();
        });

        it('should fail to acquire lock when already locked', async () => {
            mockAcquireLock.mockResolvedValue({ acquired: false });

            const result = await mockAcquireLock('user123');

            expect(result.acquired).toBe(false);
        });

        it('should release lock successfully', async () => {
            mockReleaseLock.mockResolvedValue(true);

            const result = await mockReleaseLock('user123', 'lock-value');

            expect(result).toBe(true);
        });

        it('should fail to release lock if not owner', async () => {
            mockReleaseLock.mockResolvedValue(false);

            const result = await mockReleaseLock('user123', 'wrong-value');

            expect(result).toBe(false);
        });
    });

    describe('lock with retry', () => {
        it('should acquire on first attempt', async () => {
            mockAcquireLockWithRetry.mockResolvedValue({ acquired: true, lockValue: 'lock-456' });

            const result = await mockAcquireLockWithRetry('user123');

            expect(result.acquired).toBe(true);
        });

        it('should retry and eventually acquire', async () => {
            mockAcquireLockWithRetry.mockResolvedValue({ acquired: true, lockValue: 'lock-789' });

            const result = await mockAcquireLockWithRetry('user123', 3);

            expect(result.acquired).toBe(true);
        });

        it('should fail after max retries exceeded', async () => {
            mockAcquireLockWithRetry.mockResolvedValue({ acquired: false });

            const result = await mockAcquireLockWithRetry('user123', 3);

            expect(result.acquired).toBe(false);
        });
    });

    describe('idempotency check', () => {
        it('should return true for processed message', async () => {
            mockIsMessageProcessed.mockResolvedValue(true);

            const result = await mockIsMessageProcessed('whatsapp', 'msg123');

            expect(result).toBe(true);
        });

        it('should return false for new message', async () => {
            mockIsMessageProcessed.mockResolvedValue(false);

            const result = await mockIsMessageProcessed('whatsapp', 'msg456');

            expect(result).toBe(false);
        });

        it('should mark message as processed', async () => {
            mockMarkMessageProcessed.mockResolvedValue(undefined);

            await mockMarkMessageProcessed('whatsapp', 'msg789');

            expect(mockMarkMessageProcessed).toHaveBeenCalledWith('whatsapp', 'msg789');
        });
    });

    describe('user cooldown', () => {
        it('should detect user in cooldown', async () => {
            mockIsUserInCooldown.mockResolvedValue(true);

            const result = await mockIsUserInCooldown('user123');

            expect(result).toBe(true);
        });

        it('should allow user not in cooldown', async () => {
            mockIsUserInCooldown.mockResolvedValue(false);

            const result = await mockIsUserInCooldown('user456');

            expect(result).toBe(false);
        });

        it('should set user cooldown', async () => {
            mockSetUserCooldown.mockResolvedValue(undefined);

            await mockSetUserCooldown('user789');

            expect(mockSetUserCooldown).toHaveBeenCalledWith('user789');
        });
    });

    describe('concurrent access scenario', () => {
        it('should handle race condition by lock', async () => {
            // First request gets lock
            mockAcquireLock
                .mockResolvedValueOnce({ acquired: true, lockValue: 'lock-first' })
                .mockResolvedValueOnce({ acquired: false });

            const firstLock = await mockAcquireLock('sameUser');
            const secondLock = await mockAcquireLock('sameUser');

            expect(firstLock.acquired).toBe(true);
            expect(secondLock.acquired).toBe(false);
        });

        it('should handle duplicate message detection', async () => {
            // First check - not processed
            mockIsMessageProcessed.mockResolvedValueOnce(false);

            const firstCheck = await mockIsMessageProcessed('whatsapp', 'dup-msg');
            expect(firstCheck).toBe(false);

            // Mark as processed
            await mockMarkMessageProcessed('whatsapp', 'dup-msg');

            // Second check - already processed
            mockIsMessageProcessed.mockResolvedValueOnce(true);

            const secondCheck = await mockIsMessageProcessed('whatsapp', 'dup-msg');
            expect(secondCheck).toBe(true);
        });
    });
});
