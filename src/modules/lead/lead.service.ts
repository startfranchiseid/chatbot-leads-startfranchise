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
 * Check if user ID is a WhatsApp LID format (@lid)
 */
function isLidFormat(userId: string): boolean {
  return userId.includes('@lid');
}

/**
 * Get lead by user ID
 * Checks both user_id column and whatsapp_lid column for @lid format
 */
export async function getLeadByUserId(userId: string): Promise<Lead | null> {
  // First try exact match on user_id
  let rows = await query<Lead>(
    'SELECT * FROM leads WHERE user_id = $1',
    [userId]
  );

  if (rows[0]) {
    return rows[0];
  }

  // Check if this is a @lid format, also check alt_id column
  if (isLidFormat(userId)) {
    rows = await query<Lead>(
      'SELECT * FROM leads WHERE alt_id = $1',
      [userId]
    );
    if (rows[0]) {
      logger.debug({ userId, foundVia: 'alt_id' }, 'Found lead via LID');
      return rows[0];
    }
  }

  return null;
}

/**
 * Get lead by LID (WhatsApp Linked Device ID)
 */
export async function getLeadByLid(lid: string): Promise<Lead | null> {
  const rows = await query<Lead>(
    'SELECT * FROM leads WHERE alt_id = $1',
    [lid]
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
 * Resolve User ID (Handle LID vs Phone ID migration)
 * Returns the correct user_id to use for processing
 */
export async function resolveAuthId(userId: string, altId?: string | null): Promise<string> {
  if (!altId) return userId;

  // Check if lead exists with either ID
  // Fetch ALL matches to detect split-brain
  const leads = await query<Lead>(
    `SELECT * FROM leads WHERE user_id IN ($1, $2) OR alt_id IN ($1, $2)`,
    [userId, altId]
  );

  if (leads.length === 0) return userId;

  // Check if we have the target phone ID already
  const phoneLead = leads.find(l => l.user_id === userId);
  // Check if we have the LID lead
  const lidLead = leads.find(l => l.user_id === altId);

  // SCENARIO 1: Both exist (Split Brain) -> Merge them
  if (phoneLead && lidLead && phoneLead.id !== lidLead.id) {
    logger.info({ phoneId: phoneLead.id, lidId: lidLead.id }, 'Merging duplicate leads (Phone + LID)');

    // 1. Update phone lead with alt_id if missing
    if (!phoneLead.alt_id) {
      await query(`UPDATE leads SET alt_id = $1 WHERE id = $2`, [altId, phoneLead.id]);
    }

    // 2. Delete the LID lead (it's less valuable/imported)
    // Note: In a real system we might merge interactions, but here LID comes from sync (empty history likely)
    await query(`DELETE FROM leads WHERE id = $1`, [lidLead.id]);

    return userId;
  }

  // SCENARIO 2: Only LID exists -> Migrate to Phone
  if (lidLead && !phoneLead) {
    logger.info({ oldId: lidLead.user_id, newId: userId }, 'Migrating Lead ID from LID to Phone');
    await query(
      `UPDATE leads SET user_id = $1, alt_id = $2 WHERE id = $3`,
      [userId, altId, lidLead.id]
    );
    return userId;
  }

  // SCENARIO 3: Only Phone exists (or other cases) -> Return Phone
  return userId;
}

/**
 * Create new lead
 */
export async function createLead(
  userId: string,
  source: MessageSource, // Assuming LeadSource is a typo and should be MessageSource based on context
  state: LeadState = LeadStates.NEW,
  options?: GetLeadOptions
): Promise<Lead> {
  const pushName = options?.pushName || null;
  const altId = options?.metadata?.lid || null;

  const result = await query<Lead>(
    `INSERT INTO leads (user_id, source, state, push_name, alt_id, warning_count) 
     VALUES ($1, $2, $3, $4, $5, 0) 
     RETURNING *`,
    [userId, source, state, pushName, altId]
  );

  // The instruction snippet had a partial line and duplicate logger.info.
  // Assuming the intent is to return the first result and log it.
  const lead = result[0];
  if (!lead) {
    throw new Error('Failed to create lead');
  }

  logger.info({ leadId: lead.id, userId, source, state }, 'Created new lead');
  return lead;
}

/**
 * Mark user as EXISTING (won't receive bot responses)
 * Used when: 1) Syncing old contacts 2) When WE send message to someone first
 */
export async function markAsExisting(
  userId: string,
  source: MessageSource
): Promise<Lead> {
  // Try to get existing lead first
  let lead = await getLeadByUserId(userId);

  if (lead) {
    // Only update if currently NEW (don't override other states)
    if (lead.state === LeadStates.NEW) {
      const rows = await query<Lead>(
        `UPDATE leads SET state = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [LeadStates.EXISTING, lead.id]
      );
      lead = rows[0] || lead;
      logger.info({ userId }, 'Marked existing lead as EXISTING');
    }
    return lead;
  }

  // Create new lead with EXISTING state
  lead = await createLead(userId, source, LeadStates.EXISTING);
  logger.info({ userId }, 'Created new lead as EXISTING (outgoing message)');
  return lead;
}

/**
 * Get or create lead
 */
// Helper to determine if we should update metadata
function shouldUpdateMetadata(lead: Lead, options?: GetLeadOptions): boolean {
  if (!options) return false;
  if (options.pushName && lead.push_name !== options.pushName) return true;
  if (options.metadata?.lid && !lead.alt_id) return true;
  return false;
}

export async function getOrCreateLead(
  userId: string,
  source: MessageSource,
  options?: GetLeadOptions
): Promise<{ lead: Lead; isNew: boolean }> {
  // Check if lead exists
  let lead = await getLeadByUserId(userId);
  let isNew = false;

  if (!lead) {
    // Create new lead
    lead = await createLead(userId, source, LeadStates.NEW, options);
    isNew = true;
  } else {
    // Check if we need to update metadata (PushName or Alt ID)
    if (shouldUpdateMetadata(lead, options)) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramCount = 1;

      if (options?.pushName && lead.push_name !== options.pushName) {
        updates.push(`push_name = $${paramCount++}`);
        params.push(options.pushName);
      }

      // Only update alt_id if it's missing
      if (options?.metadata?.lid && !lead.alt_id) {
        updates.push(`alt_id = $${paramCount++}`);
        params.push(options.metadata.lid);
      }

      if (updates.length > 0) {
        params.push(lead.id); // ID as last param
        const sql = `UPDATE leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
        const updated = await query<Lead>(sql, params);
        if (updated.length > 0) lead = updated[0]!;
      }
    }
  }

  return { lead, isNew };
}

export interface GetLeadOptions {
  metadata?: Record<string, any>;
  pushName?: string;
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
