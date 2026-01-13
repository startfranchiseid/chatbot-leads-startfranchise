import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import { updateLeadState, getLeadById, getRecentInteractions } from '../lead/lead.service.js';
import type { Lead, LeadState } from '../../types/lead.js';

interface LeadListQuery {
  state?: string;
  page?: number;
  limit?: number;
}

interface StateChangeBody {
  state: LeadState;
}

/**
 * Admin Controller - Dashboard API endpoints
 */
export async function adminController(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/leads - List all leads with pagination
   */
  fastify.get('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { state, page = 1, limit = 20 } = request.query as LeadListQuery;
      const offset = (page - 1) * limit;

      let queryText = `
        SELECT l.*, 
               (SELECT COUNT(*) FROM lead_interactions WHERE lead_id = l.id) as interaction_count,
               (SELECT completed FROM lead_form_data WHERE lead_id = l.id LIMIT 1) as form_completed
        FROM leads l
      `;
      const params: unknown[] = [];

      if (state) {
        queryText += ' WHERE l.state = $1';
        params.push(state);
        queryText += ` ORDER BY l.updated_at DESC LIMIT $2 OFFSET $3`;
        params.push(limit, offset);
      } else {
        queryText += ` ORDER BY l.updated_at DESC LIMIT $1 OFFSET $2`;
        params.push(limit, offset);
      }

      const leads = await query<Lead & { interaction_count: number; form_completed: boolean }>(
        queryText,
        params
      );

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM leads';
      const countParams: unknown[] = [];
      if (state) {
        countQuery += ' WHERE state = $1';
        countParams.push(state);
      }
      const countResult = await query<{ total: string }>(countQuery, countParams);
      const total = parseInt(countResult[0]?.total || '0');

      return reply.send({
        success: true,
        data: leads,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list leads');
      return reply.status(500).send({ success: false, error: 'Failed to list leads' });
    }
  });

  /**
   * GET /api/admin/leads/:id - Get lead details
   */
  fastify.get('/leads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      const lead = await getLeadById(id);
      if (!lead) {
        return reply.status(404).send({ success: false, error: 'Lead not found' });
      }

      // Get recent interactions
      const interactions = await getRecentInteractions(id, 20);

      // Get form data
      const formData = await query(
        'SELECT * FROM lead_form_data WHERE lead_id = $1',
        [id]
      );

      return reply.send({
        success: true,
        data: {
          ...lead,
          interactions,
          form_data: formData[0] || null,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get lead details');
      return reply.status(500).send({ success: false, error: 'Failed to get lead details' });
    }
  });

  /**
   * PUT /api/admin/leads/:id/state - Manually change lead state
   */
  fastify.put('/leads/:id/state', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { state } = request.body as StateChangeBody;

      if (!state) {
        return reply.status(400).send({ success: false, error: 'State is required' });
      }

      const lead = await getLeadById(id);
      if (!lead) {
        return reply.status(404).send({ success: false, error: 'Lead not found' });
      }

      // Attempt state change (admin can force any transition)
      const updatedLead = await query<Lead>(
        `UPDATE leads SET state = $1, warning_count = 0, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [state, id]
      );

      logger.info({ leadId: id, from: lead.state, to: state }, 'Admin state change');

      return reply.send({
        success: true,
        data: updatedLead[0],
        message: `State changed from ${lead.state} to ${state}`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to change lead state');
      return reply.status(500).send({ success: false, error: 'Failed to change state' });
    }
  });

  /**
   * GET /api/admin/analytics - Dashboard analytics
   */
  fastify.get('/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Lead counts by state
      const stateCounts = await query<{ state: string; count: string }>(`
        SELECT state, COUNT(*) as count 
        FROM leads 
        GROUP BY state 
        ORDER BY count DESC
      `);

      // Total leads
      const totalResult = await query<{ total: string }>('SELECT COUNT(*) as total FROM leads');
      const totalLeads = parseInt(totalResult[0]?.total || '0');

      // Leads requiring intervention
      const interventionResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM leads WHERE state = $1`,
        ['MANUAL_INTERVENTION']
      );
      const requiresIntervention = parseInt(interventionResult[0]?.count || '0');

      // Completed forms
      const completedResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM leads WHERE state = $1`,
        ['FORM_COMPLETED']
      );
      const completedForms = parseInt(completedResult[0]?.count || '0');

      // Leads by source
      const sourceCounts = await query<{ source: string; count: string }>(`
        SELECT source, COUNT(*) as count 
        FROM leads 
        GROUP BY source
      `);

      // Recent activity (last 7 days)
      const recentActivity = await query<{ date: string; count: string }>(`
        SELECT DATE(created_at) as date, COUNT(*) as count 
        FROM leads 
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at) 
        ORDER BY date DESC
      `);

      return reply.send({
        success: true,
        data: {
          totalLeads,
          requiresIntervention,
          completedForms,
          conversionRate: totalLeads > 0 ? ((completedForms / totalLeads) * 100).toFixed(1) : '0',
          byState: stateCounts.reduce((acc, row) => {
            acc[row.state] = parseInt(row.count);
            return acc;
          }, {} as Record<string, number>),
          bySource: sourceCounts.reduce((acc, row) => {
            acc[row.source] = parseInt(row.count);
            return acc;
          }, {} as Record<string, number>),
          recentActivity: recentActivity.map(row => ({
            date: row.date,
            count: parseInt(row.count),
          })),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get analytics');
      return reply.status(500).send({ success: false, error: 'Failed to get analytics' });
    }
  });
  /**
   * GET /api/admin/queues - Queue monitoring dashboard
   */
  fastify.get('/queues', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Import dynamically to avoid circular dependencies
      const { getQueueStats } = await import('../../infra/queue.js');
      const stats = await getQueueStats();

      return reply.send({
        success: true,
        data: {
          queues: stats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get queue stats');
      return reply.status(500).send({ success: false, error: 'Failed to get queue stats' });
    }
  });

  /**
   * GET /api/admin/health - Admin service health check
   */
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'admin-api' };
  });
}
