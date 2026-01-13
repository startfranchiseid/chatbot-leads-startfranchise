import { describe, it, expect } from 'vitest';
import {
    normalizeUserId,
    isWhatsAppLid,
    extractPhoneNumber,
    isGroupChat,
    isBroadcastMessage,
} from './normalize-user.js';

describe('normalize-user', () => {
    describe('isWhatsAppLid', () => {
        it('should return true for LID format', () => {
            expect(isWhatsAppLid('212188648214761@lid')).toBe(true);
        });

        it('should return false for phone format', () => {
            expect(isWhatsAppLid('6281234567890@s.whatsapp.net')).toBe(false);
        });

        it('should return false for other formats', () => {
            expect(isWhatsAppLid('user123')).toBe(false);
            expect(isWhatsAppLid('6281234567890@c.us')).toBe(false);
        });
    });

    describe('normalizeUserId', () => {
        describe('whatsapp', () => {
            it('should preserve @lid format', () => {
                expect(normalizeUserId('212188648214761@lid', 'whatsapp')).toBe('212188648214761@lid');
            });

            it('should preserve @s.whatsapp.net format', () => {
                expect(normalizeUserId('6281234567890@s.whatsapp.net', 'whatsapp')).toBe('6281234567890@s.whatsapp.net');
            });

            it('should convert @c.us to @s.whatsapp.net', () => {
                expect(normalizeUserId('6281234567890@c.us', 'whatsapp')).toBe('6281234567890@s.whatsapp.net');
            });

            it('should add @s.whatsapp.net to raw phone numbers', () => {
                expect(normalizeUserId('6281234567890', 'whatsapp')).toBe('6281234567890@s.whatsapp.net');
            });

            it('should handle phone with special characters', () => {
                expect(normalizeUserId('+62-812-3456-7890', 'whatsapp')).toBe('6281234567890@s.whatsapp.net');
            });
        });

        describe('telegram', () => {
            it('should return telegram ID as string', () => {
                expect(normalizeUserId('123456789', 'telegram')).toBe('123456789');
            });
        });
    });

    describe('extractPhoneNumber', () => {
        it('should return null for LID format', () => {
            expect(extractPhoneNumber('212188648214761@lid')).toBeNull();
        });

        it('should extract phone from @s.whatsapp.net format', () => {
            expect(extractPhoneNumber('6281234567890@s.whatsapp.net')).toBe('6281234567890');
        });

        it('should extract phone from @c.us format', () => {
            expect(extractPhoneNumber('6281234567890@c.us')).toBe('6281234567890');
        });

        it('should return raw digits as phone', () => {
            expect(extractPhoneNumber('6281234567890')).toBe('6281234567890');
        });

        it('should return null for non-phone strings', () => {
            expect(extractPhoneNumber('username123')).toBeNull();
        });
    });

    describe('isGroupChat', () => {
        describe('whatsapp', () => {
            it('should detect group chat by @g.us suffix', () => {
                expect(isGroupChat('120363123456789@g.us', 'whatsapp')).toBe(true);
            });

            it('should return false for private chat', () => {
                expect(isGroupChat('6281234567890@s.whatsapp.net', 'whatsapp')).toBe(false);
            });
        });

        describe('telegram', () => {
            it('should detect group by negative ID', () => {
                expect(isGroupChat('-100123456789', 'telegram')).toBe(true);
            });

            it('should return false for positive ID', () => {
                expect(isGroupChat('123456789', 'telegram')).toBe(false);
            });
        });
    });

    describe('isBroadcastMessage', () => {
        describe('whatsapp', () => {
            it('should detect status@broadcast', () => {
                expect(isBroadcastMessage('status@broadcast', 'whatsapp')).toBe(true);
            });

            it('should detect @broadcast suffix', () => {
                expect(isBroadcastMessage('123@broadcast', 'whatsapp')).toBe(true);
            });

            it('should return false for normal chat', () => {
                expect(isBroadcastMessage('6281234567890@s.whatsapp.net', 'whatsapp')).toBe(false);
            });
        });

        describe('telegram', () => {
            it('should return false for telegram', () => {
                expect(isBroadcastMessage('123456789', 'telegram')).toBe(false);
            });
        });
    });
});
