import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    checkIdempotency,
    markAsProcessed,
    getIdempotencyKey,
} from './idempotency.js';

// Mock Redis functions
const mockIsMessageProcessed = vi.fn();
const mockMarkMessageProcessed = vi.fn();

vi.mock('../../infra/redis.js', () => ({
    isMessageProcessed: (...args: any[]) => mockIsMessageProcessed(...args),
    markMessageProcessed: (...args: any[]) => mockMarkMessageProcessed(...args),
}));

// Mock logger
vi.mock('../../infra/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('idempotency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('checkIdempotency', () => {
        it('should return true if message already processed', async () => {
            mockIsMessageProcessed.mockResolvedValue(true);

            const result = await checkIdempotency('whatsapp', 'msg123');

            expect(result).toBe(true);
            expect(mockIsMessageProcessed).toHaveBeenCalledWith('whatsapp', 'msg123');
        });

        it('should return false if message not yet processed', async () => {
            mockIsMessageProcessed.mockResolvedValue(false);

            const result = await checkIdempotency('whatsapp', 'msg456');

            expect(result).toBe(false);
            expect(mockIsMessageProcessed).toHaveBeenCalledWith('whatsapp', 'msg456');
        });

        it('should return false and log error on Redis failure', async () => {
            mockIsMessageProcessed.mockRejectedValue(new Error('Redis connection failed'));

            const result = await checkIdempotency('telegram', 'msg789');

            // Should allow processing even on Redis failure (graceful degradation)
            expect(result).toBe(false);
        });

        it('should handle telegram source', async () => {
            mockIsMessageProcessed.mockResolvedValue(false);

            await checkIdempotency('telegram', 'tg123');

            expect(mockIsMessageProcessed).toHaveBeenCalledWith('telegram', 'tg123');
        });
    });

    describe('markAsProcessed', () => {
        it('should call markMessageProcessed', async () => {
            mockMarkMessageProcessed.mockResolvedValue(undefined);

            await markAsProcessed('whatsapp', 'msg123');

            expect(mockMarkMessageProcessed).toHaveBeenCalledWith('whatsapp', 'msg123');
        });

        it('should handle Redis failure gracefully', async () => {
            mockMarkMessageProcessed.mockRejectedValue(new Error('Redis write failed'));

            // Should not throw, just log error
            await expect(markAsProcessed('whatsapp', 'msg123')).resolves.toBeUndefined();
        });

        it('should work for telegram source', async () => {
            mockMarkMessageProcessed.mockResolvedValue(undefined);

            await markAsProcessed('telegram', 'tg456');

            expect(mockMarkMessageProcessed).toHaveBeenCalledWith('telegram', 'tg456');
        });
    });

    describe('getIdempotencyKey', () => {
        it('should generate correct key for whatsapp', () => {
            const key = getIdempotencyKey('whatsapp', 'msg123');
            expect(key).toBe('processed:whatsapp:msg123');
        });

        it('should generate correct key for telegram', () => {
            const key = getIdempotencyKey('telegram', 'tg456');
            expect(key).toBe('processed:telegram:tg456');
        });

        it('should handle special characters in messageId', () => {
            const key = getIdempotencyKey('whatsapp', 'msg-123_abc');
            expect(key).toBe('processed:whatsapp:msg-123_abc');
        });
    });

    describe('duplicate detection scenario', () => {
        it('should detect duplicate within same test run', async () => {
            // First call - not processed
            mockIsMessageProcessed.mockResolvedValueOnce(false);

            const firstCheck = await checkIdempotency('whatsapp', 'duplicate-msg');
            expect(firstCheck).toBe(false);

            // Mark as processed
            await markAsProcessed('whatsapp', 'duplicate-msg');

            // Second call - already processed
            mockIsMessageProcessed.mockResolvedValueOnce(true);

            const secondCheck = await checkIdempotency('whatsapp', 'duplicate-msg');
            expect(secondCheck).toBe(true);
        });
    });
});
