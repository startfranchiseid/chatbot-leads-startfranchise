import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp, initializeServices } from '../../app.js';
import { closePool } from '../../infra/db.js';
import { closeRedis, getRedis } from '../../infra/redis.js';
import { closeQueues } from '../../infra/queue.js';

// Mock Queues to prevent actual job creation
vi.mock('../../infra/queue.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        addSheetsSyncJob: vi.fn(),
        addTelegramNotifyJob: vi.fn(),
    };
});

describe('Message Ignore Logic (E2E)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        try {
            await initializeServices();
            app = await buildApp();
            await app.ready();
        } catch (error) {
            console.error('Setup failed:', error);
            throw error;
        }
    });

    afterAll(async () => {
        if (app) await app.close();
        await closeQueues().catch(e => console.error('Queue close error:', e));
        await closeRedis().catch(e => console.error('Redis close error:', e));
        await closePool().catch(e => console.error('DB close error:', e));
    });

    it('should ignore group chat messages (@g.us)', async () => {
        const payload = {
            event: 'message',
            payload: {
                id: 'false_123456789@g.us_AB123456789',
                from: '123456789@g.us',
                to: '628123456789@s.whatsapp.net',
                fromMe: false,
                body: 'Hello Group',
                chatId: '123456789@g.us',
                isGroup: true,
                _data: {
                    key: {
                        remoteJid: '123456789@g.us',
                        fromMe: false,
                    }
                }
            }
        };

        const response = await app.inject({
            method: 'POST',
            url: '/api/waha/webhook',
            payload
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.type).toBe('group_ignored');
    });

    it('should ignore broadcast messages (@broadcast)', async () => {
        const payload = {
            event: 'message',
            payload: {
                id: 'false_status@broadcast_AB123456789',
                from: 'status@broadcast',
                to: '628123456789@s.whatsapp.net',
                fromMe: false,
                body: 'Hello Broadcast',
                chatId: 'status@broadcast',
                _data: {
                    key: {
                        remoteJid: 'status@broadcast',
                        fromMe: false,
                    }
                }
            }
        };

        const response = await app.inject({
            method: 'POST',
            url: '/api/waha/webhook',
            payload
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.type).toBe('broadcast_ignored');
    });

    it('should ignore self messages (fromMe)', async () => {
        // Self message handling might be in controller or parser
        // Based on controller, it calls processOutgoingWebhook for outgoing

        const payload = {
            event: 'message',
            payload: {
                id: 'true_123456789@s.whatsapp.net_AB123456789',
                from: '628123456789@s.whatsapp.net',
                to: '628999999999@s.whatsapp.net',
                fromMe: true, // Self message
                body: 'My own message',
                _data: {
                    key: {
                        remoteJid: '628999999999@s.whatsapp.net',
                        fromMe: true,
                    }
                }
            }
        };

        const response = await app.inject({
            method: 'POST',
            url: '/api/waha/webhook',
            payload
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.type).toBe('outgoing'); // Controller marks self messages as outgoing
    });
});
