import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { logger } from './infra/logger.js';
import { initializeDatabase } from './infra/db.js';
import { getRedis } from './infra/redis.js';
import { wahaController } from './modules/inbound/waha.controller.js';
import { telegramController } from './modules/inbound/telegram.controller.js';
import { adminController } from './modules/admin/admin.controller.js';
import { metricsController } from './modules/metrics/metrics.controller.js';
import { docsController } from './modules/docs/docs.controller.js';
import { initializeSheet } from './modules/integration/sheets.worker.js';
import { startSyncJobs } from './jobs/sync-to-sheets.job.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true,
    requestTimeout: 30000,
    bodyLimit: 1048576, // 1MB
  });

  // Register rate limiting
  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    errorResponseBuilder: (request, context) => {
      return {
        code: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. You can make ${context.max} requests per ${context.after}`,
      };
    },
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url, method: request.method }, 'Request error');

    const statusCode = error instanceof Error && 'statusCode' in error
      ? (error as { statusCode: number }).statusCode
      : 500;
    const errorName = error instanceof Error ? error.name : 'Internal Server Error';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    reply.status(statusCode).send({
      error: errorName,
      message: errorMessage,
    });
  });

  // Request logging
  app.addHook('onRequest', async (request) => {
    logger.debug({ url: request.url, method: request.method }, 'Incoming request');
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.debug(
      { url: request.url, method: request.method, statusCode: reply.statusCode },
      'Request completed'
    );
  });

  // Health check endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Ready check endpoint (checks dependencies)
  app.get('/ready', async (request, reply) => {
    try {
      // Check Redis
      const redis = getRedis();
      await redis.ping();

      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'ok',
          database: 'ok',
        },
      };
    } catch (error) {
      logger.error({ error }, 'Readiness check failed');
      return reply.status(503).send({
        status: 'not ready',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // API info endpoint
  app.get('/', async () => {
    return {
      name: 'Chatbot Leads API',
      version: '1.0.0',
      description: 'WhatsApp & Telegram lead management system',
      endpoints: {
        health: '/health',
        ready: '/ready',
        waha: '/api/waha/webhook',
        telegram: '/api/telegram/webhook',
        admin: '/api/admin/*',
        metrics: '/metrics',
        docs: '/api/docs',
      },
    };
  });

  // Register controllers
  await app.register(wahaController, { prefix: '/api/waha' });
  await app.register(telegramController, { prefix: '/api/telegram' });
  await app.register(adminController, { prefix: '/api/admin' });
  await app.register(metricsController, { prefix: '/metrics' });
  await app.register(docsController, { prefix: '/api/docs' });

  return app;
}

export async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  // Initialize database schema
  await initializeDatabase();
  logger.info('Database initialized');

  // Initialize Redis (connection test)
  const redis = getRedis();
  await redis.ping();
  logger.info('Redis connected');

  // Initialize Google Sheets (if configured)
  if (process.env.GOOGLE_SPREADSHEET_ID) {
    await initializeSheet();
    logger.info('Google Sheets initialized');
  }

  // Start background workers
  startSyncJobs();
  logger.info('Background workers started');

  logger.info('All services initialized');
}
