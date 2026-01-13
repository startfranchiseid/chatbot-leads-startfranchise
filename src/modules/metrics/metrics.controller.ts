import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../infra/db.js';
import { getRedis } from '../../infra/redis.js';
import { logger } from '../../infra/logger.js';

// Simple in-memory metrics store
const metrics = {
    http_requests_total: 0,
    http_requests_errors: 0,
    webhooks_processed: 0,
    leads_created: 0,
    forms_completed: 0,
    escalations_triggered: 0,
};

/**
 * Increment a metric counter
 */
export function incrementMetric(name: keyof typeof metrics, value: number = 1): void {
    if (name in metrics) {
        metrics[name] += value;
    }
}

/**
 * Metrics Controller - Prometheus compatible endpoints
 */
export async function metricsController(fastify: FastifyInstance): Promise<void> {
    /**
     * GET /metrics - Prometheus format metrics
     */
    fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // Get database stats
            const leadStats = await query<{ state: string; count: string }>(`
        SELECT state, COUNT(*) as count 
        FROM leads 
        GROUP BY state
      `);

            const totalLeads = await query<{ count: string }>('SELECT COUNT(*) as count FROM leads');
            const totalInteractions = await query<{ count: string }>('SELECT COUNT(*) as count FROM lead_interactions');
            const completedForms = await query<{ count: string }>(
                `SELECT COUNT(*) as count FROM lead_form_data WHERE completed = true`
            );

            // Get Redis stats
            let redisConnected = 0;
            try {
                const redis = getRedis();
                await redis.ping();
                redisConnected = 1;
            } catch {
                redisConnected = 0;
            }

            // Build Prometheus format output
            const lines: string[] = [
                '# HELP chatbot_leads_total Total number of leads',
                '# TYPE chatbot_leads_total gauge',
                `chatbot_leads_total ${totalLeads[0]?.count || 0}`,
                '',
                '# HELP chatbot_interactions_total Total number of lead interactions',
                '# TYPE chatbot_interactions_total gauge',
                `chatbot_interactions_total ${totalInteractions[0]?.count || 0}`,
                '',
                '# HELP chatbot_forms_completed_total Total completed forms',
                '# TYPE chatbot_forms_completed_total gauge',
                `chatbot_forms_completed_total ${completedForms[0]?.count || 0}`,
                '',
                '# HELP chatbot_leads_by_state Number of leads by state',
                '# TYPE chatbot_leads_by_state gauge',
            ];

            // Add per-state counts
            for (const row of leadStats) {
                lines.push(`chatbot_leads_by_state{state="${row.state}"} ${row.count}`);
            }

            lines.push('');
            lines.push('# HELP chatbot_redis_connected Redis connection status (1=connected, 0=disconnected)');
            lines.push('# TYPE chatbot_redis_connected gauge');
            lines.push(`chatbot_redis_connected ${redisConnected}`);
            lines.push('');
            lines.push('# HELP chatbot_http_requests_total Total HTTP requests processed');
            lines.push('# TYPE chatbot_http_requests_total counter');
            lines.push(`chatbot_http_requests_total ${metrics.http_requests_total}`);
            lines.push('');
            lines.push('# HELP chatbot_http_errors_total Total HTTP request errors');
            lines.push('# TYPE chatbot_http_errors_total counter');
            lines.push(`chatbot_http_errors_total ${metrics.http_requests_errors}`);
            lines.push('');
            lines.push('# HELP chatbot_webhooks_processed_total Total webhooks processed');
            lines.push('# TYPE chatbot_webhooks_processed_total counter');
            lines.push(`chatbot_webhooks_processed_total ${metrics.webhooks_processed}`);
            lines.push('');
            lines.push('# HELP process_uptime_seconds Process uptime in seconds');
            lines.push('# TYPE process_uptime_seconds gauge');
            lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);
            lines.push('');
            lines.push('# HELP nodejs_heap_used_bytes Node.js heap memory used');
            lines.push('# TYPE nodejs_heap_used_bytes gauge');
            lines.push(`nodejs_heap_used_bytes ${process.memoryUsage().heapUsed}`);
            lines.push('');
            lines.push('# HELP nodejs_heap_total_bytes Node.js heap memory total');
            lines.push('# TYPE nodejs_heap_total_bytes gauge');
            lines.push(`nodejs_heap_total_bytes ${process.memoryUsage().heapTotal}`);

            reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return reply.send(lines.join('\n'));
        } catch (error) {
            logger.error({ error }, 'Failed to generate metrics');
            return reply.status(500).send('Failed to generate metrics');
        }
    });

    /**
     * GET /metrics/json - JSON format metrics for easier consumption
     */
    fastify.get('/json', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const leadStats = await query<{ state: string; count: string }>(`
        SELECT state, COUNT(*) as count 
        FROM leads 
        GROUP BY state
      `);

            const totalLeads = await query<{ count: string }>('SELECT COUNT(*) as count FROM leads');
            const totalInteractions = await query<{ count: string }>('SELECT COUNT(*) as count FROM lead_interactions');

            return reply.send({
                success: true,
                timestamp: new Date().toISOString(),
                metrics: {
                    leads: {
                        total: parseInt(totalLeads[0]?.count || '0'),
                        byState: leadStats.reduce((acc, row) => {
                            acc[row.state] = parseInt(row.count);
                            return acc;
                        }, {} as Record<string, number>),
                    },
                    interactions: {
                        total: parseInt(totalInteractions[0]?.count || '0'),
                    },
                    process: {
                        uptime: process.uptime(),
                        memoryUsage: process.memoryUsage(),
                    },
                    counters: metrics,
                },
            });
        } catch (error) {
            logger.error({ error }, 'Failed to generate JSON metrics');
            return reply.status(500).send({ success: false, error: 'Failed to generate metrics' });
        }
    });
}
