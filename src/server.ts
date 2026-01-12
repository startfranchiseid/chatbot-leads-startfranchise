import 'dotenv/config';
import { buildApp, initializeServices } from './app.js';
import { closePool } from './infra/db.js';
import { closeRedis } from './infra/redis.js';
import { closeQueues } from './infra/queue.js';
import { logger } from './infra/logger.js';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  try {
    // Initialize all services
    await initializeServices();

    // Build and start the app
    const app = await buildApp();

    await app.listen({ port: PORT, host: HOST });

    logger.info({ port: PORT, host: HOST }, 'Server started');
    logger.info(`🚀 Chatbot Leads API running at http://${HOST}:${PORT}`);
    logger.info(`📝 WAHA Webhook: http://${HOST}:${PORT}/api/waha/webhook`);
    logger.info(`📝 Telegram Webhook: http://${HOST}:${PORT}/api/telegram/webhook`);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');

      try {
        await app.close();
        await closeQueues();
        await closeRedis();
        await closePool();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled rejection');
      shutdown('unhandledRejection');
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
