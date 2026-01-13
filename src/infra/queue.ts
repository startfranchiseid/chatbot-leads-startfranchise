import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { getRedis } from './redis.js';
import { logger } from './logger.js';
import type { LeadFormData, EscalationInfo } from '../types/lead.js';

// Queue Names
export const QUEUE_NAMES = {
  SHEETS_SYNC: 'sheets-sync',
  TELEGRAM_NOTIFY: 'telegram-notify',
} as const;

// Job Types
export interface SheetsSyncJobData {
  leadId: string;
  formData: LeadFormData;
  userId: string;
  source: string;
}

export interface TelegramNotifyJobData {
  type: 'escalation' | 'new_lead' | 'form_completed' | 'partnership_interest' | 'general_inquiry' | 'other_needs';
  data: EscalationInfo | { leadId: string; userId: string; formData?: LeadFormData };
}

// Queues
let sheetsSyncQueue: Queue<SheetsSyncJobData> | null = null;
let telegramNotifyQueue: Queue<TelegramNotifyJobData> | null = null;

// Workers
let sheetsSyncWorker: Worker<SheetsSyncJobData> | null = null;
let telegramNotifyWorker: Worker<TelegramNotifyJobData> | null = null;

// Queue Events
let sheetsSyncEvents: QueueEvents | null = null;
let telegramNotifyEvents: QueueEvents | null = null;

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

export function getSheetsSyncQueue(): Queue<SheetsSyncJobData> {
  if (!sheetsSyncQueue) {
    sheetsSyncQueue = new Queue<SheetsSyncJobData>(QUEUE_NAMES.SHEETS_SYNC, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });

    sheetsSyncQueue.on('error', (err) => {
      logger.error({ err, queue: QUEUE_NAMES.SHEETS_SYNC }, 'Queue error');
    });
  }
  return sheetsSyncQueue;
}

export function getTelegramNotifyQueue(): Queue<TelegramNotifyJobData> {
  if (!telegramNotifyQueue) {
    telegramNotifyQueue = new Queue<TelegramNotifyJobData>(QUEUE_NAMES.TELEGRAM_NOTIFY, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    telegramNotifyQueue.on('error', (err) => {
      logger.error({ err, queue: QUEUE_NAMES.TELEGRAM_NOTIFY }, 'Queue error');
    });
  }
  return telegramNotifyQueue;
}

// Add jobs to queues
export async function addSheetsSyncJob(data: SheetsSyncJobData): Promise<Job<SheetsSyncJobData>> {
  const queue = getSheetsSyncQueue();
  const job = await queue.add('sync-lead', data, {
    jobId: `sheets-${data.leadId}-${Date.now()}`,
  });
  logger.info({ jobId: job.id, leadId: data.leadId }, 'Added sheets sync job');
  return job;
}

export async function addTelegramNotifyJob(
  data: TelegramNotifyJobData
): Promise<Job<TelegramNotifyJobData>> {
  const queue = getTelegramNotifyQueue();
  const job = await queue.add(data.type, data, {
    jobId: `telegram-${data.type}-${Date.now()}`,
  });
  logger.info({ jobId: job.id, type: data.type }, 'Added telegram notify job');
  return job;
}

// Initialize workers (call this when starting worker process)
export function initializeWorkers(
  sheetsSyncProcessor: (job: Job<SheetsSyncJobData>) => Promise<void>,
  telegramNotifyProcessor: (job: Job<TelegramNotifyJobData>) => Promise<void>
): void {
  sheetsSyncWorker = new Worker<SheetsSyncJobData>(
    QUEUE_NAMES.SHEETS_SYNC,
    sheetsSyncProcessor,
    {
      connection,
      concurrency: 5,
    }
  );

  sheetsSyncWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Sheets sync job completed');
  });

  sheetsSyncWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Sheets sync job failed');
  });

  telegramNotifyWorker = new Worker<TelegramNotifyJobData>(
    QUEUE_NAMES.TELEGRAM_NOTIFY,
    telegramNotifyProcessor,
    {
      connection,
      concurrency: 3,
    }
  );

  telegramNotifyWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Telegram notify job completed');
  });

  telegramNotifyWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Telegram notify job failed');
  });

  logger.info('Queue workers initialized');
}

// Close queues and workers
export async function closeQueues(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (sheetsSyncWorker) {
    closePromises.push(sheetsSyncWorker.close());
  }
  if (telegramNotifyWorker) {
    closePromises.push(telegramNotifyWorker.close());
  }
  if (sheetsSyncQueue) {
    closePromises.push(sheetsSyncQueue.close());
  }
  if (telegramNotifyQueue) {
    closePromises.push(telegramNotifyQueue.close());
  }
  if (sheetsSyncEvents) {
    closePromises.push(sheetsSyncEvents.close());
  }
  if (telegramNotifyEvents) {
    closePromises.push(telegramNotifyEvents.close());
  }

  await Promise.all(closePromises);
  logger.info('All queues and workers closed');
}

/**
 * Get queue statistics for monitoring dashboard
 */
export async function getQueueStats(): Promise<{
  sheets: { waiting: number; active: number; completed: number; failed: number };
  telegram: { waiting: number; active: number; completed: number; failed: number };
}> {
  const sheetsQueue = getSheetsSyncQueue();
  const telegramQueue = getTelegramNotifyQueue();

  const [sheetsWaiting, sheetsActive, sheetsCompleted, sheetsFailed] = await Promise.all([
    sheetsQueue.getWaitingCount(),
    sheetsQueue.getActiveCount(),
    sheetsQueue.getCompletedCount(),
    sheetsQueue.getFailedCount(),
  ]);

  const [telegramWaiting, telegramActive, telegramCompleted, telegramFailed] = await Promise.all([
    telegramQueue.getWaitingCount(),
    telegramQueue.getActiveCount(),
    telegramQueue.getCompletedCount(),
    telegramQueue.getFailedCount(),
  ]);

  return {
    sheets: {
      waiting: sheetsWaiting,
      active: sheetsActive,
      completed: sheetsCompleted,
      failed: sheetsFailed,
    },
    telegram: {
      waiting: telegramWaiting,
      active: telegramActive,
      completed: telegramCompleted,
      failed: telegramFailed,
    },
  };
}
