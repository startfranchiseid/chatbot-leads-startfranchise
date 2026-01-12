import Redis from 'ioredis';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });

    redis.on('ready', () => {
      logger.info('Redis ready');
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}

// Distributed Lock Implementation
const LOCK_TTL_SECONDS = parseInt(process.env.LOCK_TTL_SECONDS || '10');

export interface LockResult {
  acquired: boolean;
  lockValue?: string;
}

export async function acquireLock(
  userId: string,
  ttlSeconds: number = LOCK_TTL_SECONDS
): Promise<LockResult> {
  const redis = getRedis();
  const lockKey = `lock:user:${userId}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // SET NX with expiration - atomic operation
  const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');

  if (result === 'OK') {
    logger.debug({ userId, lockKey, lockValue }, 'Lock acquired');
    return { acquired: true, lockValue };
  }

  logger.debug({ userId, lockKey }, 'Lock not acquired - already locked');
  return { acquired: false };
}

export async function releaseLock(userId: string, lockValue: string): Promise<boolean> {
  const redis = getRedis();
  const lockKey = `lock:user:${userId}`;

  // Lua script to ensure we only release our own lock
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const result = await redis.eval(script, 1, lockKey, lockValue);

  if (result === 1) {
    logger.debug({ userId, lockKey }, 'Lock released');
    return true;
  }

  logger.warn({ userId, lockKey }, 'Failed to release lock - not owner or already released');
  return false;
}

// Lock with retry
export async function acquireLockWithRetry(
  userId: string,
  maxRetries: number = 3,
  retryDelayMs: number = 100
): Promise<LockResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await acquireLock(userId);
    if (result.acquired) {
      return result;
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  logger.warn({ userId, maxRetries }, 'Failed to acquire lock after retries');
  return { acquired: false };
}

// Idempotency Check
const IDEMPOTENCY_TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400'); // 24 hours

export async function isMessageProcessed(source: string, messageId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `processed:${source}:${messageId}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

export async function markMessageProcessed(
  source: string,
  messageId: string,
  ttlSeconds: number = IDEMPOTENCY_TTL_SECONDS
): Promise<void> {
  const redis = getRedis();
  const key = `processed:${source}:${messageId}`;
  await redis.setex(key, ttlSeconds, '1');
  logger.debug({ source, messageId, key }, 'Message marked as processed');
}

// User Cooldown (Anti-Spam)
const USER_COOLDOWN_SECONDS = parseInt(process.env.USER_COOLDOWN_SECONDS || '2'); // 2 seconds between responses

export async function isUserInCooldown(userId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `cooldown:${userId}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

export async function setUserCooldown(
  userId: string,
  ttlSeconds: number = USER_COOLDOWN_SECONDS
): Promise<void> {
  const redis = getRedis();
  const key = `cooldown:${userId}`;
  await redis.setex(key, ttlSeconds, '1');
  logger.debug({ userId, key, ttl: ttlSeconds }, 'User cooldown set');
}

// Message Queue for batching (collect rapid messages before responding)
const MESSAGE_BATCH_WAIT_MS = parseInt(process.env.MESSAGE_BATCH_WAIT_MS || '1500'); // 1.5 seconds

export async function addToPendingMessages(userId: string, messageId: string, text: string): Promise<number> {
  const redis = getRedis();
  const key = `pending:${userId}`;
  const message = JSON.stringify({ messageId, text, timestamp: Date.now() });
  const length = await redis.rpush(key, message);
  await redis.expire(key, 60); // Expire after 60 seconds
  return length;
}

export async function getPendingMessages(userId: string): Promise<Array<{ messageId: string; text: string; timestamp: number }>> {
  const redis = getRedis();
  const key = `pending:${userId}`;
  const messages = await redis.lrange(key, 0, -1);
  return messages.map(m => JSON.parse(m));
}

export async function clearPendingMessages(userId: string): Promise<void> {
  const redis = getRedis();
  const key = `pending:${userId}`;
  await redis.del(key);
}

export async function setPendingLock(userId: string, ttlMs: number = MESSAGE_BATCH_WAIT_MS): Promise<boolean> {
  const redis = getRedis();
  const key = `pending_lock:${userId}`;
  const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}

export async function isPendingLockActive(userId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `pending_lock:${userId}`;
  const exists = await redis.exists(key);
  return exists === 1;
}
