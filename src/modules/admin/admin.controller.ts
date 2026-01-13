import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { updateLeadState, getLeadById, getRecentInteractions } from '../lead/lead.service.js';
import type { Lead, LeadState } from '../../types/lead.js';
import { testGoogleSheetsConnection } from '../integration/sheets.worker.js';
import { getRedis } from '../../infra/redis.js';

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
   * POST /api/admin/leads/sync - Reset DB and sync from WAHA
   */
  fastify.post('/leads/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 1. Truncate tables
      await query('TRUNCATE leads CASCADE');

      // 2. Fetch contacts from WAHA
      const wahaUrl = process.env.WAHA_API_URL || 'http://localhost:3000';
      const wahaKey = process.env.WAHA_API_KEY;
      const sessionName = process.env.WAHA_SESSION_NAME || 'default';

      const headers: Record<string, string> = {};
      if (wahaKey) headers['X-Api-Key'] = wahaKey;

      // User specified endpoint: /api/contacts/all
      const response = await fetch(`${wahaUrl}/api/contacts/all?session=${sessionName}`, { headers });

      if (!response.ok) {
        throw new Error(`WAHA API Error: ${response.status} ${response.statusText}`);
      }

      const contacts = await response.json() as any[];

      // 3. Insert into DB
      let importedCount = 0;
      for (const contact of contacts) {
        // contact.id is usually "628xxx@c.us"
        const userId = contact.id;
        if (!userId) continue;

        // Skip group chats (@g.us) or status (@broadcast)
        // Also skip 'status@broadcast' specifically just in case
        if (userId.includes('@g.us') || userId.includes('broadcast')) continue;

        // Insert as IMPORTED so bot doesn't auto-respond
        await query(
          `INSERT INTO leads (user_id, state, source) VALUES ($1, 'IMPORTED', 'whatsapp') ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );
        importedCount++;
      }

      return reply.send({ success: true, imported: importedCount, message: `Synced ${importedCount} contacts` });

    } catch (error: any) {
      logger.error({ error }, 'Failed to sync leads');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/admin/leads - List all leads with pagination & search
   */
  fastify.get('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { state, q, page = 1, limit = 20 } = request.query as LeadListQuery & { q?: string };
      const offset = (page - 1) * limit;

      let queryText = `
        SELECT l.*, 
               (SELECT COUNT(*) FROM lead_interactions WHERE lead_id = l.id) as interaction_count,
               (SELECT completed FROM lead_form_data WHERE lead_id = l.id LIMIT 1) as form_completed,
               (SELECT biodata FROM lead_form_data WHERE lead_id = l.id LIMIT 1) as form_name
        FROM leads l
      `;
      const params: unknown[] = [];
      const whereClauses: string[] = [];

      if (state) {
        params.push(state);
        whereClauses.push(`l.state = $${params.length}`);
      }

      if (q) {
        params.push(`%${q}%`);
        // Search in user_id or in lead_form_data (biodata/name)
        whereClauses.push(`(
          l.user_id ILIKE $${params.length} OR 
          EXISTS(SELECT 1 FROM lead_form_data fd WHERE fd.lead_id = l.id AND fd.biodata ILIKE $${params.length})
        )`);
      }

      if (whereClauses.length > 0) {
        queryText += ' WHERE ' + whereClauses.join(' AND ');
      }

      queryText += ` ORDER BY l.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const leads = await query<Lead & { interaction_count: number; form_completed: boolean; form_name?: string }>(
        queryText,
        params
      );

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM leads l';
      const countParams: unknown[] = [];

      if (whereClauses.length > 0) {
        // Reuse the same where clauses but parameters need to be re-indexed if we weren't careful
        // Easier to just rebuild params for count
        const countWhere: string[] = [];
        if (state) {
          countParams.push(state);
          countWhere.push(`l.state = $${countParams.length}`);
        }
        if (q) {
          countParams.push(`%${q}%`);
          countWhere.push(`(
            l.user_id ILIKE $${countParams.length} OR 
            EXISTS(SELECT 1 FROM lead_form_data fd WHERE fd.lead_id = l.id AND fd.biodata ILIKE $${countParams.length})
          )`);
        }
        countQuery += ' WHERE ' + countWhere.join(' AND ');
      }

      const countResult = await query<{ total: string }>(countQuery, countParams);
      const total = parseInt(countResult[0]?.total || '0');

      return reply.send({
        success: true,
        data: leads,
        pagination: {
          page: Number(page),
          limit: Number(limit),
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
   * POST /api/admin/leads - Create new lead manually
   */
  fastify.post('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id, name } = request.body as { user_id: string; name?: string };

      if (!user_id) {
        return reply.status(400).send({ success: false, error: 'User ID (Phone) is required' });
      }

      // Check existence
      const existing = await query('SELECT id FROM leads WHERE user_id = $1 LIMIT 1', [user_id]);
      if (existing.length > 0) {
        return reply.status(409).send({ success: false, error: 'Lead with this number already exists' });
      }

      const { createLead } = await import('../lead/lead.service.js');

      // Create lead
      const lead = await createLead(user_id, 'whatsapp', 'NEW'); // Default to NEW

      // If name provided, add to form data
      if (name) {
        await query(
          `INSERT INTO lead_form_data (lead_id, biodata, completed, created_at) VALUES ($1, $2, false, NOW())`,
          [lead.id, name]
        );
      }

      logger.info({ leadId: lead.id, userId: user_id }, 'Admin manually created lead');
      return reply.send({ success: true, data: lead });
    } catch (error: any) {
      logger.error({ error }, 'Failed to create lead');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /api/admin/leads - Delete ALL leads (Clear Database)
   */
  fastify.delete('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { confirm } = request.query as { confirm?: string };
      if (confirm !== 'true') {
        return reply.status(400).send({ success: false, error: 'Checking "confirm=true" required' });
      }

      await query('TRUNCATE leads CASCADE');
      logger.info('Admin cleared ALL leads');

      return reply.send({ success: true, message: 'All leads deleted successfully' });
    } catch (error) {
      logger.error({ error }, 'Failed to clear leads');
      return reply.status(500).send({ success: false, error: 'Failed to clear leads' });
    }
  });

  /**
   * PUT /api/admin/leads/:id - Update lead details
   */
  fastify.put('/leads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { state, name, phone } = request.body as { state?: LeadState; name?: string; phone?: string };

      const lead = await getLeadById(id);
      if (!lead) return reply.status(404).send({ success: false, error: 'Not Found' });

      // Update State / Phone
      if (state || phone) {
        const updateParts: string[] = [];
        const params: unknown[] = [];
        if (state) {
          params.push(state);
          updateParts.push(`state = $${params.length}`);
        }
        if (phone) {
          params.push(phone);
          updateParts.push(`user_id = $${params.length}`);
        }

        if (updateParts.length > 0) {
          params.push(id);
          await query(`UPDATE leads SET ${updateParts.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
        }
      }

      // Update Name (Biodata) in form_data
      if (name !== undefined) {
        // Check if form data exists
        const existingForm = await query('SELECT id FROM lead_form_data WHERE lead_id = $1', [id]);
        if (existingForm.length > 0) {
          await query('UPDATE lead_form_data SET biodata = $1 WHERE lead_id = $2', [name, id]);
        } else {
          await query('INSERT INTO lead_form_data (lead_id, biodata, completed, created_at) VALUES ($1, $2, false, NOW())', [id, name]);
        }
      }

      return reply.send({ success: true, message: 'Lead updated' });
    } catch (error: any) {
      logger.error({ error }, 'Failed to update lead');
      return reply.status(500).send({ success: false, error: error.message });
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

  /**
   * DELETE /api/admin/leads/:id - Delete lead and related data
   */
  fastify.delete('/leads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      const lead = await getLeadById(id);
      if (!lead) {
        return reply.status(404).send({ success: false, error: 'Lead not found' });
      }

      // Delete in correct order due to FK constraints (or use CASCADE if configured, but safe side here)
      await query('DELETE FROM lead_form_data WHERE lead_id = $1', [id]);
      await query('DELETE FROM lead_interactions WHERE lead_id = $1', [id]);
      await query('DELETE FROM leads WHERE id = $1', [id]);

      logger.info({ leadId: id }, 'Admin deleted lead');

      return reply.send({ success: true, message: 'Lead deleted successfully' });
    } catch (error) {
      logger.error({ error }, 'Failed to delete lead');
      return reply.status(500).send({ success: false, error: 'Failed to delete lead' });
    }
  });

  /**
   * GET /api/admin/webhooks - List recent webhooks (Paginated)
   */
  fastify.get('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
      const offset = (page - 1) * limit;

      const logs = await query(
        `SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await query<{ total: string }>(
        `SELECT COUNT(*) as total FROM webhook_logs`
      );
      const total = parseInt(countResult[0]?.total || '0');

      return reply.send({
        success: true,
        data: logs,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list webhooks');
      // Return empty array if table doesn't exist yet (graceful degradation)
      return reply.send({ success: true, data: [] });
    }
  });

  /**
   * DELETE /api/admin/webhooks - Clear webhook logs
   */
  fastify.delete('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await query('TRUNCATE TABLE webhook_logs');
      logger.info('Admin cleared webhook history');
      return reply.send({ success: true, message: 'History cleared' });
    } catch (error) {
      logger.error({ error }, 'Failed to clear webhooks');
      return reply.status(500).send({ success: false, error: 'Failed' });
    }
  });

  /**
   * POST /api/admin/test-connection - Check service health
   */
  fastify.post('/test-connection', async (request: FastifyRequest, reply: FastifyReply) => {
    const { service } = request.body as { service: 'postgres' | 'redis' | 'google-sheets' | 'waha' };

    try {
      if (service === 'postgres') {
        await query('SELECT 1');
        return reply.send({ success: true, message: 'PostgreSQL Connected' });
      }

      if (service === 'redis') {
        const redis = await getRedis();
        await redis.ping();
        return reply.send({ success: true, message: 'Redis Connected' });
      }

      if (service === 'google-sheets') {
        const result = await testGoogleSheetsConnection();
        if (!result.success) throw new Error(result.message);
        return reply.send({ success: true, message: 'Google Sheets Connected' });
      }

      if (service === 'waha') {
        const wahaUrl = process.env.WAHA_API_URL || 'http://localhost:3000';
        const wahaKey = process.env.WAHA_API_KEY;
        const headers: Record<string, string> = {};
        if (wahaKey) headers['X-Api-Key'] = wahaKey;

        const res = await fetch(`${wahaUrl}/api/sessions?all=true`, { headers });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        return reply.send({ success: true, message: 'WAHA API Connected' });
      }

      return reply.status(400).send({ success: false, error: 'Unknown service' });

    } catch (error: any) {
      logger.error({ error, service }, 'Connection test failed');
      return reply.status(500).send({ success: false, error: error.message || 'Connection Failed' });
    }
  });

  /**
   * GET /api/admin/config - Get permissible env vars (masked)
   */
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only return safe/editable configs to avoid leaking sensitive secrets to frontend if not needed
    // Or return all but mask secrets
    const config = {
      PORT: process.env.PORT,
      WAHA_API_URL: process.env.WAHA_API_URL,
      WAHA_SESSION_NAME: process.env.WAHA_SESSION_NAME,
      WAHA_API_KEY: process.env.WAHA_API_KEY,
      WAHA_WEBHOOK_PATH: process.env.WAHA_WEBHOOK_PATH,
      LOCK_TTL_SECONDS: process.env.LOCK_TTL_SECONDS,
      USER_COOLDOWN_MS: process.env.USER_COOLDOWN_MS,
      GOOGLE_SHEET_NAME: process.env.GOOGLE_SHEET_NAME,
      GOOGLE_SPREADSHEET_ID: process.env.GOOGLE_SPREADSHEET_ID,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
      // Secrets (masked)
      DB_HOST: process.env.DB_HOST,
      REDIS_HOST: process.env.REDIS_HOST,
    };
    return reply.send({ success: true, data: config });
  });

  /**
   * POST /api/admin/config - Update env vars
   */
  fastify.post('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const updates = request.body as Record<string, string>;
      const allowedKeys = [
        'WAHA_API_URL', 'WAHA_SESSION_NAME', 'WAHA_API_KEY', 'WAHA_WEBHOOK_PATH',
        'LOCK_TTL_SECONDS', 'USER_COOLDOWN_MS',
        'GOOGLE_SHEET_NAME', 'GOOGLE_SPREADSHEET_ID',
        'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
        'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'
      ];

      // Read current .env
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf-8');
      } catch (e) {
        // Start fresh if no .env
        envContent = '';
      }

      // Parse current env to map
      const envMap: Record<string, string> = {};
      envContent.split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && !line.startsWith('#')) {
          envMap[key.trim()] = vals.join('=').trim();
        }
      });

      // Apply updates if allowed
      let changed = false;
      for (const [key, value] of Object.entries(updates)) {
        if (allowedKeys.includes(key)) {
          envMap[key] = value;
          changed = true;
        }
      }

      if (!changed) {
        return reply.send({ success: true, message: 'No changes made' });
      }

      // Reconstruct .env content
      // Preserve comments is hard without a parser, simple reconstruction is strictly key=value
      // Better approach: Regex replace existing keys, append new ones
      let newContent = envContent;
      for (const [key, value] of Object.entries(updates)) {
        if (allowedKeys.includes(key)) {
          const regex = new RegExp(`^${key}=.*`, 'm');
          if (regex.test(newContent)) {
            newContent = newContent.replace(regex, `${key}=${value}`);
          } else {
            newContent += `\n${key}=${value}`;
          }
        }
      }

      await fs.writeFile(envPath, newContent.trim() + '\n');

      logger.info({ updates: Object.keys(updates) }, 'Admin updated .env config');

      return reply.send({ success: true, message: 'Configuration updated. Server restart may be required.' });
    } catch (error) {
      logger.error({ error }, 'Failed to update config');
      return reply.status(500).send({ success: false, error: 'Failed to update config' });
    }
  });

  // ============================================================
  // Custom Bot Messages API
  // ============================================================

  /**
   * GET /api/admin/messages - List all bot messages
   */
  fastify.get('/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getAllMessages } = await import('../message/message.config.js');
      const messages = await getAllMessages();
      return reply.send({ success: true, data: messages });
    } catch (error) {
      logger.error({ error }, 'Failed to get messages');
      return reply.status(500).send({ success: false, error: 'Failed to get messages' });
    }
  });

  /**
   * PUT /api/admin/messages/:key - Update a bot message
   */
  fastify.put('/messages/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { key } = request.params as { key: string };
      const { content } = request.body as { content: string };

      if (!content) {
        return reply.status(400).send({ success: false, error: 'Content is required' });
      }

      const { updateMessage } = await import('../message/message.config.js');
      const updated = await updateMessage(key, content);

      if (!updated) {
        return reply.status(404).send({ success: false, error: 'Message key not found' });
      }

      logger.info({ key }, 'Admin updated bot message');
      return reply.send({ success: true, message: 'Message updated successfully' });
    } catch (error) {
      logger.error({ error }, 'Failed to update message');
      return reply.status(500).send({ success: false, error: 'Failed to update message' });
    }
  });
}
