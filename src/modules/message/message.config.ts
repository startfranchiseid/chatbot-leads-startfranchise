import { query } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';

// Default bot messages (used for seeding and fallback)
export const DEFAULT_MESSAGES: Record<string, { content: string; description: string }> = {
    WELCOME: {
        content: `Halo! 👋 Selamat datang di StartFranchise.

Kami membantu Anda menemukan peluang franchise terbaik.

Silakan pilih:
1️⃣ Minat Franchise
2️⃣ Daftar Sebagai Franchisor
3️⃣ Keperluan lain / Kerja sama`,
        description: 'Pesan selamat datang untuk user baru',
    },
    CHOOSE_OPTION: {
        content: `Terima kasih! Agar kami dapat membantu merekomendasikan franchise yang paling tepat untuk Anda, mohon lengkapi info singkat berikut:
  
📝 *Info Calon Mitra*

Silakan copy template di bawah ini, isi data Anda, lalu kirim kembali:`,
        description: 'Intro sebelum form template',
    },
    FORM_TEMPLATE: {
        content: `Nama, Domisili: 
Sumber info: 
Jenis bisnis: 
Budget: 
Rencana mulai: `,
        description: 'Template form yang harus diisi user',
    },
    FORM_RECEIVED: {
        content: `✅ Terima kasih! Data Anda sudah kami terima.

Tim konsultan kami akan menganalisa kebutuhan Anda dan segera menghubungi Anda untuk memberikan rekomendasi franchise terbaik.

Jika ada pertanyaan tambahan, silakan chat langsung di sini.`,
        description: 'Konfirmasi setelah form diterima',
    },
    PARTNERSHIP: {
        content: `Terima kasih atas minat Anda untuk mendaftarkan bisnis sebagai franchisor!

Tim partnership kami akan segera menghubungi Anda untuk diskusi lebih lanjut.

Mohon tunggu konfirmasi dari tim kami.`,
        description: 'Respon untuk minat jadi franchisor',
    },
    QUESTION_RECEIVED: {
        content: `Terima kasih! 

Tim kami akan segera merespons pesan Anda.

Mohon tunggu, kami akan membalas secepatnya.`,
        description: 'Respon untuk pertanyaan umum',
    },
    INVALID_OPTION: {
        content: `Maaf, pilihan tidak valid. Silakan pilih:

1️⃣ Minat Franchise
2️⃣ Daftar Sebagai Franchisor
3️⃣ Keperluan lain / Kerja sama`,
        description: 'Pesan error jika input tidak valid',
    },
    ESCALATION_NOTICE: {
        content: `Terima kasih atas kesabaran Anda.

Tim customer service kami akan segera menghubungi Anda secara langsung.

Mohon tunggu, kami akan membantu Anda secepatnya.`,
        description: 'Pesan saat eskalasi ke admin',
    },
    OTHER_NEEDS: {
        content: `Terima kasih! 

Tim kami akan segera merespons pesan Anda.

Mohon tunggu, kami akan membalas secepatnya.`,
        description: 'Respon untuk keperluan lain',
    },
};

// In-memory cache
let messageCache: Map<string, string> | null = null;

/**
 * Initialize message config - seed default messages if not exist
 */
export async function initMessageConfig(): Promise<void> {
    try {
        for (const [key, { content, description }] of Object.entries(DEFAULT_MESSAGES)) {
            await query(
                `INSERT INTO bot_messages (key, content, description) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (key) DO NOTHING`,
                [key, content, description]
            );
        }
        logger.info('Bot messages initialized');
        // Pre-load cache
        await loadMessagesCache();
    } catch (error) {
        logger.error({ error }, 'Failed to initialize message config');
    }
}

/**
 * Load all messages into cache
 */
async function loadMessagesCache(): Promise<void> {
    const rows = await query<{ key: string; content: string }>(
        'SELECT key, content FROM bot_messages'
    );
    messageCache = new Map(rows.map((r) => [r.key, r.content]));
    logger.debug({ count: rows.length }, 'Messages cache loaded');
}

/**
 * Get message by key (from cache or DB)
 */
export async function getMessage(key: string): Promise<string> {
    // Try cache first
    if (messageCache?.has(key)) {
        return messageCache.get(key)!;
    }

    // Fallback to DB
    const rows = await query<{ content: string }>(
        'SELECT content FROM bot_messages WHERE key = $1',
        [key]
    );

    if (rows[0]) {
        // Update cache
        if (!messageCache) messageCache = new Map();
        messageCache.set(key, rows[0].content);
        return rows[0].content;
    }

    // Ultimate fallback to default
    return DEFAULT_MESSAGES[key]?.content || '';
}

/**
 * Get all messages
 */
export async function getAllMessages(): Promise<
    { key: string; content: string; description: string; updated_at: Date }[]
> {
    return query(
        'SELECT key, content, description, updated_at FROM bot_messages ORDER BY key'
    );
}

/**
 * Update message
 */
export async function updateMessage(key: string, content: string): Promise<boolean> {
    const result = await query(
        'UPDATE bot_messages SET content = $1, updated_at = NOW() WHERE key = $2 RETURNING key',
        [content, key]
    );

    if (result.length > 0) {
        // Invalidate cache
        if (messageCache) {
            messageCache.set(key, content);
        }
        logger.info({ key }, 'Bot message updated');
        return true;
    }
    return false;
}
