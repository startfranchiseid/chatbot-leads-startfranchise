import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction, getClient } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import {
  Lead,
  LeadFormData,
  LeadInteraction,
  LeadState,
  LeadStates,
  MessageDirection,
  MessageSource,
} from '../../types/lead.js';
import { attemptTransition, isValidTransition } from './lead.state.js';

/**
 * Get lead by user ID
 */
export async function getLeadByUserId(userId: string): Promise<Lead | null> {
  const rows = await query<Lead>(
    'SELECT * FROM leads WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

/**
 * Get lead by ID
 */
export async function getLeadById(id: string): Promise<Lead | null> {
  const rows = await query<Lead>('SELECT * FROM leads WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Create new lead
 */
export async function createLead(
  userId: string,
  source: MessageSource
): Promise<Lead> {
  const id = uuidv4();
  const rows = await query<Lead>(
    `INSERT INTO leads (id, user_id, source, state, warning_count)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING *`,
    [id, userId, source, LeadStates.NEW]
  );

  const lead = rows[0];
  if (!lead) {
    throw new Error('Failed to create lead');
  }

  logger.info({ leadId: id, userId, source }, 'Created new lead');
  return lead;
}

/**
 * Get or create lead
 */
export async function getOrCreateLead(
  userId: string,
  source: MessageSource
): Promise<{ lead: Lead; isNew: boolean }> {
  let lead = await getLeadByUserId(userId);

  if (!lead) {
    lead = await createLead(userId, source);
    return { lead, isNew: true };
  }

  return { lead, isNew: false };
}

/**
 * Update lead state with validation
 */
export async function updateLeadState(
  leadId: string,
  newState: LeadState,
  client?: PoolClient
): Promise<Lead | null> {
  const executeQuery = async (c: PoolClient) => {
    // Get current state with row lock
    const currentRows = await c.query<Lead>(
      'SELECT * FROM leads WHERE id = $1 FOR UPDATE',
      [leadId]
    );

    const currentLead = currentRows.rows[0];
    if (!currentLead) {
      return null;
    }

    // Validate transition
    const transition = attemptTransition(currentLead.state as LeadState, newState);
    if (!transition.success) {
      throw new Error(transition.error);
    }

    // Update state
    const updateRows = await c.query<Lead>(
      `UPDATE leads 
       SET state = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [newState, leadId]
    );

    const updatedLead = updateRows.rows[0];
    logger.info(
      { leadId, from: currentLead.state, to: newState },
      'Lead state updated'
    );

    return updatedLead || null;
  };

  if (client) {
    return executeQuery(client);
  }

  return withTransaction(executeQuery);
}

/**
 * Increment warning count
 */
export async function incrementWarningCount(
  leadId: string,
  client?: PoolClient
): Promise<{ lead: Lead; shouldEscalate: boolean }> {
  const MAX_WARNINGS = 3;

  const executeQuery = async (c: PoolClient) => {
    const rows = await c.query<Lead>(
      `UPDATE leads 
       SET warning_count = warning_count + 1, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [leadId]
    );

    const lead = rows.rows[0];
    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    const shouldEscalate = lead.warning_count >= MAX_WARNINGS;

    logger.info(
      { leadId, warningCount: lead.warning_count, shouldEscalate },
      'Warning count incremented'
    );

    return { lead, shouldEscalate };
  };

  if (client) {
    return executeQuery(client);
  }

  return withTransaction(executeQuery);
}

/**
 * Reset warning count
 */
export async function resetWarningCount(leadId: string): Promise<Lead | null> {
  const rows = await query<Lead>(
    `UPDATE leads 
     SET warning_count = 0, updated_at = NOW() 
     WHERE id = $1 
     RETURNING *`,
    [leadId]
  );

  return rows[0] || null;
}

/**
 * Add interaction log
 */
export async function addInteraction(
  leadId: string,
  messageId: string,
  message: string,
  direction: MessageDirection,
  client?: PoolClient
): Promise<LeadInteraction> {
  const id = uuidv4();

  const executeQuery = async (c: PoolClient) => {
    const rows = await c.query<LeadInteraction>(
      `INSERT INTO lead_interactions (id, lead_id, message_id, message, direction)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, leadId, messageId, message, direction]
    );

    const interaction = rows.rows[0];
    if (!interaction) {
      throw new Error('Failed to create interaction');
    }

    return interaction;
  };

  if (client) {
    return executeQuery(client);
  }

  const c = await getClient();
  try {
    return await executeQuery(c);
  } finally {
    c.release();
  }
}

/**
 * Get lead form data
 */
export async function getLeadFormData(leadId: string): Promise<LeadFormData | null> {
  const rows = await query<LeadFormData>(
    'SELECT * FROM lead_form_data WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
    [leadId]
  );
  return rows[0] || null;
}

/**
 * Create or update form data
 */
export async function upsertFormData(
  leadId: string,
  data: Partial<LeadFormData>,
  client?: PoolClient
): Promise<LeadFormData> {
  const executeQuery = async (c: PoolClient) => {
    // Check if form data exists
    const existing = await c.query<LeadFormData>(
      'SELECT * FROM lead_form_data WHERE lead_id = $1',
      [leadId]
    );

    if (existing.rows[0]) {
      // Update existing
      const rows = await c.query<LeadFormData>(
        `UPDATE lead_form_data 
         SET source_info = COALESCE($1, source_info),
             business_type = COALESCE($2, business_type),
             budget = COALESCE($3, budget),
             start_plan = COALESCE($4, start_plan),
             completed = COALESCE($5, completed)
         WHERE lead_id = $6
         RETURNING *`,
        [
          data.source_info,
          data.business_type,
          data.budget,
          data.start_plan,
          data.completed,
          leadId,
        ]
      );

      return rows.rows[0]!;
    }

    // Create new
    const id = uuidv4();
    const rows = await c.query<LeadFormData>(
      `INSERT INTO lead_form_data (id, lead_id, source_info, business_type, budget, start_plan, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        leadId,
        data.source_info || null,
        data.business_type || null,
        data.budget || null,
        data.start_plan || null,
        data.completed || false,
      ]
    );

    return rows.rows[0]!;
  };

  if (client) {
    return executeQuery(client);
  }

  return withTransaction(executeQuery);
}

/**
 * Get recent interactions for a lead
 */
export async function getRecentInteractions(
  leadId: string,
  limit: number = 10
): Promise<LeadInteraction[]> {
  return query<LeadInteraction>(
    `SELECT * FROM lead_interactions 
     WHERE lead_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [leadId, limit]
  );
}

/**
 * Get leads requiring manual intervention
 */
export async function getLeadsRequiringIntervention(): Promise<Lead[]> {
  return query<Lead>(
    `SELECT * FROM leads 
     WHERE state = $1 
     ORDER BY updated_at DESC`,
    [LeadStates.MANUAL_INTERVENTION]
  );
}

/**
 * Get completed leads not yet synced (for audit/recovery)
 */
export async function getCompletedLeadsWithFormData(): Promise<
  (Lead & { form_data: LeadFormData })[]
> {
  const rows = await query<Lead & { form_data: LeadFormData }>(
    `SELECT l.*, 
            row_to_json(f.*) as form_data
     FROM leads l
     JOIN lead_form_data f ON l.id = f.lead_id
     WHERE l.state = $1 AND f.completed = true
     ORDER BY l.updated_at DESC`,
    [LeadStates.FORM_COMPLETED]
  );

  return rows;
}
