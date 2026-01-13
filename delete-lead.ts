import 'dotenv/config';
import { getPool } from './src/infra/db.js';
import { normalizeUserId } from './src/utils/normalize-user.js';

async function deleteLead() {
    const phoneNumber = '6281252374308';
    const userId = normalizeUserId(phoneNumber, 'whatsapp');

    console.log(`Targeting user_id: ${userId}`);

    const pool = getPool();

    try {
        // 1. Get Lead ID first
        const leadRes = await pool.query('SELECT id FROM leads WHERE user_id = $1', [userId]);

        if (leadRes.rowCount === 0) {
            console.log(`⚠️ No lead found with user_id ${userId}`);
            return;
        }

        const leadId = leadRes.rows[0].id;
        console.log(`Found lead ID: ${leadId}`);

        // 2. Delete Form Data
        const formRes = await pool.query('DELETE FROM lead_form_data WHERE lead_id = $1', [leadId]);
        console.log(`🗑️ Deleted ${formRes.rowCount} form data records`);

        // 3. Delete Interactions
        const interactionRes = await pool.query('DELETE FROM lead_interactions WHERE lead_id = $1', [leadId]);
        console.log(`🗑️ Deleted ${interactionRes.rowCount} interactions`);

        // 4. Delete Lead
        const res = await pool.query(
            'DELETE FROM leads WHERE id = $1 RETURNING id',
            [leadId]
        );

        console.log(`✅ Successfully deleted lead with user_id ${userId}`);
    } catch (err) {
        console.error('Error deleting lead:', err);
    } finally {
        await pool.end();
    }
}

deleteLead();
