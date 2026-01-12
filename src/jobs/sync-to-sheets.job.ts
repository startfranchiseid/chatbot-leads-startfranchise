import { initializeWorkers } from '../infra/queue.js';
import { sheetsWorkerProcessor } from '../modules/integration/sheets.worker.js';
import { telegramWorkerProcessor } from '../modules/integration/telegram.worker.js';
import { logger } from '../infra/logger.js';

/**
 * Background job: Sync completed leads to Google Sheets
 * 
 * This job runs as part of the worker process and handles:
 * - Syncing form data to Google Sheets
 * - Retry with exponential backoff on failure
 * - Logging for audit trail
 */

export function startSyncJobs(): void {
  logger.info('Starting sync jobs workers');

  // Initialize queue workers
  initializeWorkers(sheetsWorkerProcessor, telegramWorkerProcessor);

  logger.info('Sync jobs workers started');
}

// If running as standalone worker
if (process.argv[1]?.includes('sync-to-sheets.job')) {
  import('dotenv').then(({ config }) => {
    config();
    startSyncJobs();
    logger.info('Worker process started');
  });
}
