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
        source_info TEXT,
        business_type TEXT,
        budget TEXT,
        start_plan TEXT,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
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

    logger.info('Database schema initialized successfully');
  } finally {
    client.release();
  }
}
