import { Pool, PoolClient } from 'pg';
import { logger } from './logger.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected PostgreSQL pool error');
    });

    pool.on('connect', () => {
      logger.debug('New PostgreSQL client connected');
    });
  }
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  const pool = getPool();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug({ text, duration, rows: result.rowCount }, 'Executed query');
  return result.rows as T[];
}

export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

// Transaction helper
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

// Initialize database schema
export async function initializeDatabase(): Promise<void> {
  const client = await getClient();
  try {
    // Create ENUM types if not exist
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE message_source AS ENUM ('whatsapp', 'telegram');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE message_direction AS ENUM ('in', 'out');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create leads table
    // user_id = phone@s.whatsapp.net (primary identifier)
    // whatsapp_lid = @lid format (alternative identifier for linked devices)
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT UNIQUE NOT NULL,
        whatsapp_lid TEXT,
        source message_source NOT NULL,
        state TEXT NOT NULL DEFAULT 'NEW',
        warning_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Add whatsapp_lid column if not exists (for existing tables)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Create index on whatsapp_lid
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_lid ON leads(whatsapp_lid) WHERE whatsapp_lid IS NOT NULL;
    `);

    // Add alt_id column if not exists (replaced whatsapp_lid)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS alt_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_leads_alt_id ON leads(alt_id) WHERE alt_id IS NOT NULL;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Add push_name column if not exists
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS push_name TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Create lead_interactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_interactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        message TEXT NOT NULL,
        direction message_direction NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create lead_form_data table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_form_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        biodata TEXT,
        source_info TEXT,
        business_type TEXT,
        budget TEXT,
        start_plan TEXT,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Add biodata column if not exists (migration)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE lead_form_data ADD COLUMN IF NOT EXISTS biodata TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
      CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
      CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id ON lead_interactions(lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_interactions_created_at ON lead_interactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_lead_form_data_lead_id ON lead_form_data(lead_id);
    `);

    // Create bot_messages table for customizable messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_messages (
        key VARCHAR(50) PRIMARY KEY,
        content TEXT NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create webhook_logs table for history
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source VARCHAR(50),
        status VARCHAR(50),
        session_name VARCHAR(100),
        event_type VARCHAR(100),
        payload JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Add source and status columns to webhook_logs if not exist
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS source VARCHAR(50);
        ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS status VARCHAR(50);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Create waha_sessions table for multi-number management
    await client.query(`
      CREATE TABLE IF NOT EXISTS waha_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_name VARCHAR(100) UNIQUE NOT NULL,
        phone_number VARCHAR(50),
        waha_url VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) NOT NULL,
        webhook_enabled BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        last_seen_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Seed default WAHA session from env vars if table is empty
    await client.query(`
      INSERT INTO waha_sessions (session_name, waha_url, api_key, webhook_enabled, phone_number)
      SELECT 
        $1, $2, $3, true, NULL
      WHERE NOT EXISTS (SELECT 1 FROM waha_sessions LIMIT 1);
    `, [
      process.env.WAHA_SESSION_NAME || 'default',
      process.env.WAHA_API_URL || 'http://localhost:3001',
      process.env.WAHA_API_KEY || ''
    ]);

    logger.info('Database schema initialized successfully');
  } finally {
    client.release();
  }
}
