import { describe, it, expect, vi } from 'vitest';
import {
    parseWAHAMessage,
    parseTelegramMessage,
    validateMessage,
    extractCommand,
    detectIntent,
} from './message.parser.js';
import type { WAHAWebhookPayload, TelegramUpdate, InboundMessage } from '../../types/lead.js';

// Mock the logger and normalize-user utilities
vi.mock('../../infra/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('message.parser', () => {
    describe('parseWAHAMessage', () => {
        it('should parse valid WAHA message', () => {
            const payload: WAHAWebhookPayload = {
                event: 'message',
                payload: {
                    id: 'msg123',
                    from: '6281234567890@s.whatsapp.net',
                    body: 'Hello World',
                    fromMe: false,
                    timestamp: 1234567890,
                },
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).not.toBeNull();
            expect(result!.source).toBe('whatsapp');
            expect(result!.messageId).toBe('msg123');
            expect(result!.text).toBe('Hello World');
            expect(result!.fromMe).toBe(false);
        });

        it('should return null for self messages (fromMe)', () => {
            const payload: WAHAWebhookPayload = {
                event: 'message',
                payload: {
                    id: 'msg123',
                    from: '6281234567890@s.whatsapp.net',
                    body: 'Hello',
                    fromMe: true,
                    timestamp: 1234567890,
                },
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).toBeNull();
        });

        it('should return null for group messages', () => {
            const payload: WAHAWebhookPayload = {
                event: 'message',
                payload: {
                    id: 'msg123',
                    from: '6281234567890@s.whatsapp.net',
                    chatId: '120363123456789@g.us',
                    body: 'Hello',
                    fromMe: false,
                    isGroup: true,
                    timestamp: 1234567890,
                },
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).toBeNull();
        });

        it('should return null for non-message events', () => {
            const payload: WAHAWebhookPayload = {
                event: 'session.status',
                payload: {} as any,
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).toBeNull();
        });

        it('should handle LID format user IDs', () => {
            const payload: WAHAWebhookPayload = {
                event: 'message',
                payload: {
                    id: 'msg123',
                    from: '212188648214761@lid',
                    body: 'Hello',
                    fromMe: false,
                    timestamp: 1234567890,
                },
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).not.toBeNull();
            expect(result!.userId).toContain('@lid');
        });

        it('should return null for missing payload', () => {
            const payload: WAHAWebhookPayload = {
                event: 'message',
                payload: null as any,
            } as WAHAWebhookPayload;

            const result = parseWAHAMessage(payload);
            expect(result).toBeNull();
        });
    });

    describe('parseTelegramMessage', () => {
        it('should parse valid Telegram message', () => {
            const update: TelegramUpdate = {
                update_id: 123456,
                message: {
                    message_id: 789,
                    from: {
                        id: 123456789,
                        is_bot: false,
                        first_name: 'Test',
                    },
                    chat: {
                        id: 123456789,
                        type: 'private',
                    },
                    date: 1234567890,
                    text: 'Hello Telegram',
                },
            } as TelegramUpdate;

            const result = parseTelegramMessage(update);
            expect(result).not.toBeNull();
            expect(result!.source).toBe('telegram');
            expect(result!.text).toBe('Hello Telegram');
        });

        it('should return null for bot messages', () => {
            const update: TelegramUpdate = {
                update_id: 123456,
                message: {
                    message_id: 789,
                    from: {
                        id: 123456789,
                        is_bot: true,
                        first_name: 'Bot',
                    },
                    chat: {
                        id: 123456789,
                        type: 'private',
                    },
                    date: 1234567890,
                    text: 'Bot message',
                },
            } as TelegramUpdate;

            const result = parseTelegramMessage(update);
            expect(result).toBeNull();
        });

        it('should return null for group messages', () => {
            const update: TelegramUpdate = {
                update_id: 123456,
                message: {
                    message_id: 789,
                    from: {
                        id: 123456789,
                        is_bot: false,
                        first_name: 'Test',
                    },
                    chat: {
                        id: -100123456789,
                        type: 'group',
                    },
                    date: 1234567890,
                    text: 'Group message',
                },
            } as TelegramUpdate;

            const result = parseTelegramMessage(update);
            expect(result).toBeNull();
        });

        it('should return null for updates without text', () => {
            const update: TelegramUpdate = {
                update_id: 123456,
                message: {
                    message_id: 789,
                    from: {
                        id: 123456789,
                        is_bot: false,
                        first_name: 'Test',
                    },
                    chat: {
                        id: 123456789,
                        type: 'private',
                    },
                    date: 1234567890,
                },
            } as TelegramUpdate;

            const result = parseTelegramMessage(update);
            expect(result).toBeNull();
        });
    });

    describe('validateMessage', () => {
        const validMessage: InboundMessage = {
            source: 'whatsapp',
            messageId: 'msg123',
            userId: '6281234567890@s.whatsapp.net',
            text: 'Hello',
            fromMe: false,
            isGroup: false,
            isBroadcast: false,
            timestamp: 1234567890,
            rawPayload: {},
        };

        it('should validate correct message', () => {
            const result = validateMessage(validMessage);
            expect(result.valid).toBe(true);
        });

        it('should reject missing messageId', () => {
            const result = validateMessage({ ...validMessage, messageId: '' });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('message ID');
        });

        it('should reject missing userId', () => {
            const result = validateMessage({ ...validMessage, userId: '' });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('user ID');
        });

        it('should reject self messages', () => {
            const result = validateMessage({ ...validMessage, fromMe: true });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Self');
        });

        it('should reject group messages', () => {
            const result = validateMessage({ ...validMessage, isGroup: true });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Group');
        });

        it('should reject broadcast messages', () => {
            const result = validateMessage({ ...validMessage, isBroadcast: true });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Broadcast');
        });

        it('should reject empty text', () => {
            const result = validateMessage({ ...validMessage, text: '' });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Empty');
        });
    });

    describe('extractCommand', () => {
        it('should extract simple command', () => {
            const result = extractCommand('/start');
            expect(result.command).toBe('start');
            expect(result.args).toBe('');
        });

        it('should extract command with arguments', () => {
            const result = extractCommand('/help topic1');
            expect(result.command).toBe('help');
            expect(result.args).toBe('topic1');
        });

        it('should extract command with bot mention', () => {
            const result = extractCommand('/start@mybot');
            expect(result.command).toBe('start');
        });

        it('should return null command for non-command text', () => {
            const result = extractCommand('Hello world');
            expect(result.command).toBeNull();
            expect(result.args).toBe('Hello world');
        });
    });

    describe('detectIntent', () => {
        it('should detect greeting intent', () => {
            expect(detectIntent('Halo')).toBe('greeting');
            expect(detectIntent('Hello')).toBe('greeting');
            expect(detectIntent('Selamat pagi')).toBe('greeting');
            expect(detectIntent('hi')).toBe('greeting');
        });

        it('should detect option selection', () => {
            expect(detectIntent('1')).toBe('option_select');
            expect(detectIntent('2')).toBe('option_select');
        });

        it('should detect questions', () => {
            expect(detectIntent('Apa itu franchise?')).toBe('question');
            expect(detectIntent('Bagaimana cara daftar?')).toBe('question');
            expect(detectIntent('What is this?')).toBe('question');
        });

        it('should detect form response', () => {
            const formMessage = `Sumber: Instagram
Bisnis: FnB
Budget: 100jt
Mulai: bulan depan`;
            expect(detectIntent(formMessage)).toBe('form_response');
        });

        it('should return unknown for ambiguous messages', () => {
            expect(detectIntent('Ok')).toBe('unknown');
            expect(detectIntent('Terima kasih')).toBe('unknown');
        });
    });
});
