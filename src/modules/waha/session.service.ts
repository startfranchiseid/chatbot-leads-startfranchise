import { query } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';

export interface WAHASession {
    id: string;
    session_name: string;
    phone_number: string | null;
    waha_url: string;
    api_key: string;
    webhook_enabled: boolean;
    is_active: boolean;
    last_seen_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface CreateSessionInput {
    session_name: string;
    waha_url: string;
    api_key: string;
    phone_number?: string;
    webhook_enabled?: boolean;
}

export interface UpdateSessionInput {
    waha_url?: string;
    api_key?: string;
    phone_number?: string;
    webhook_enabled?: boolean;
}

/**
 * Get all active WAHA sessions
 */
export async function getAllSessions(): Promise<WAHASession[]> {
    const sessions = await query<WAHASession>(
        `SELECT * FROM waha_sessions WHERE is_active = true ORDER BY created_at ASC`
    );
    return sessions;
}

/**
 * Get session by name
 */
export async function getSessionByName(sessionName: string): Promise<WAHASession | null> {
    const sessions = await query<WAHASession>(
        `SELECT * FROM waha_sessions WHERE session_name = $1 AND is_active = true`,
        [sessionName]
    );
    return sessions[0] || null;
}

/**
 * Create new WAHA session
 */
export async function createSession(input: CreateSessionInput): Promise<WAHASession> {
    const sessions = await query<WAHASession>(
        `INSERT INTO waha_sessions (session_name, waha_url, api_key, phone_number, webhook_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [
            input.session_name,
            input.waha_url,
            input.api_key,
            input.phone_number || null,
            input.webhook_enabled ?? true
        ]
    );

    logger.info({ sessionName: input.session_name }, 'WAHA session created');
    return sessions[0]!;
}

/**
 * Update WAHA session
 */
export async function updateSession(
    sessionName: string,
    input: UpdateSessionInput
): Promise<WAHASession | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (input.waha_url !== undefined) {
        updates.push(`waha_url = $${paramCount++}`);
        params.push(input.waha_url);
    }

    if (input.api_key !== undefined) {
        updates.push(`api_key = $${paramCount++}`);
        params.push(input.api_key);
    }

    if (input.phone_number !== undefined) {
        updates.push(`phone_number = $${paramCount++}`);
        params.push(input.phone_number);
    }

    if (input.webhook_enabled !== undefined) {
        updates.push(`webhook_enabled = $${paramCount++}`);
        params.push(input.webhook_enabled);
    }

    if (updates.length === 0) {
        return getSessionByName(sessionName);
    }

    updates.push(`updated_at = NOW()`);
    params.push(sessionName);

    const sessions = await query<WAHASession>(
        `UPDATE waha_sessions 
     SET ${updates.join(', ')}
     WHERE session_name = $${paramCount} AND is_active = true
     RETURNING *`,
        params
    );

    logger.info({ sessionName }, 'WAHA session updated');
    return sessions[0] || null;
}

/**
 * Delete WAHA session (soft delete)
 */
export async function deleteSession(sessionName: string): Promise<boolean> {
    const result = await query(
        `UPDATE waha_sessions SET is_active = false, updated_at = NOW()
     WHERE session_name = $1 AND is_active = true`,
        [sessionName]
    );

    logger.info({ sessionName }, 'WAHA session deleted');
    return result.length > 0;
}

/**
 * Toggle webhook on/off
 */
export async function toggleWebhook(
    sessionName: string,
    enabled: boolean
): Promise<WAHASession | null> {
    const sessions = await query<WAHASession>(
        `UPDATE waha_sessions 
     SET webhook_enabled = $1, updated_at = NOW()
     WHERE session_name = $2 AND is_active = true
     RETURNING *`,
        [enabled, sessionName]
    );

    logger.info({ sessionName, enabled }, 'WAHA webhook toggled');
    return sessions[0] || null;
}

/**
 * Update last seen timestamp
 */
export async function updateSessionLastSeen(sessionName: string): Promise<void> {
    await query(
        `UPDATE waha_sessions SET last_seen_at = NOW() WHERE session_name = $1`,
        [sessionName]
    );
}

/**
 * Get WAHA session status from API
 */
export async function getSessionStatus(session: WAHASession): Promise<{
    online: boolean;
    phone?: string;
    error?: string;
}> {
    try {
        const response = await fetch(`${session.waha_url}/api/sessions/${session.session_name}`, {
            headers: {
                'X-Api-Key': session.api_key,
            },
        });

        if (!response.ok) {
            return { online: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json() as { status?: string; me?: { id?: string } };
        return {
            online: data.status === 'WORKING' || data.status === 'SCAN_QR_CODE',
            phone: data.me?.id || undefined,
        };
    } catch (error) {
        logger.error({ error, sessionName: session.session_name }, 'Failed to get WAHA session status');
        return { online: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
