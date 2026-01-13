import { describe, it, expect, vi } from 'vitest';
import {
    parseFormData,
    validateFormData,
    isFormSubmission,
    getMissingFieldsMessage,
} from './lead.validator.js';

// Mock the logger
vi.mock('../../infra/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('lead.validator', () => {
    describe('parseFormData', () => {
        it('should parse sumber/source field', () => {
            const result = parseFormData('Sumber: Instagram');
            expect(result.source_info).toContain('Instagram');
        });

        it('should parse bisnis/business type field', () => {
            const result = parseFormData('Jenis bisnis: F&B Kuliner');
            expect(result.business_type).toContain('F&B');
        });

        it('should parse budget field', () => {
            const result = parseFormData('Budget: 100 juta');
            expect(result.budget).toContain('100');
        });

        it('should parse rencana mulai/start plan field', () => {
            const result = parseFormData('Rencana mulai: 3 bulan lagi');
            expect(result.start_plan).toContain('bulan');
        });

        it('should parse biodata (Nama, Domisili) field', () => {
            const result = parseFormData('Nama: Budi, Jakarta');
            expect(result.biodata).toContain('Budi');
        });

        it('should parse multiple fields from single message', () => {
            const message = `Nama: Budi, Jakarta
Sumber: Instagram
Bisnis: FnB
Budget: 50 juta
Mulai: segera`;
            const result = parseFormData(message);
            expect(result.biodata).toBeDefined();
            expect(result.source_info).toBeDefined();
        });

        it('should detect fields by keywords', () => {
            const result = parseFormData('Saya Budi dari Jakarta, dapat info dari Instagram, tertarik bisnis fnb dengan budget 100jt');
            expect(result.source_info).toBeDefined();
            expect(result.business_type).toBeDefined();
            expect(result.budget).toBeDefined();
        });

        it('should correctly parse fields when some are empty (Regression Test)', () => {
            const message = `Nama: 
Sumber: 
Bisnis: F&B
Mulai: 3 bulan lagi`;
            const result = parseFormData(message);

            expect(result.biodata).toBeUndefined();
            expect(result.source_info).toBeUndefined();
            expect(result.business_type).toContain('F&B');
            expect(result.start_plan).toContain('3 bulan');
            expect(result.budget).toBeUndefined(); // Should not match 'm' in Mulai
        });
    });

    describe('validateFormData', () => {
        it('should return valid for complete form data', () => {
            const formData = {
                biodata: 'Budi, Jakarta',
                source_info: 'Instagram',
                business_type: 'F&B',
                budget: '100 juta',
                start_plan: '3 bulan',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(true);
            expect(result.errors).toBeUndefined();
        });

        it('should return invalid for missing biodata', () => {
            const formData = {
                source_info: 'Instagram',
                business_type: 'F&B',
                budget: '100 juta',
                start_plan: '3 bulan',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThan(0);
        });

        it('should return invalid for missing source_info', () => {
            const formData = {
                biodata: 'Budi, Jakarta',
                business_type: 'F&B',
                budget: '100 juta',
                start_plan: '3 bulan',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
        });

        it('should return invalid for missing business_type', () => {
            const formData = {
                biodata: 'Budi, Jakarta',
                source_info: 'Instagram',
                budget: '100 juta',
                start_plan: '3 bulan',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
        });

        it('should return invalid for missing budget', () => {
            const formData = {
                biodata: 'Budi, Jakarta',
                source_info: 'Instagram',
                business_type: 'F&B',
                start_plan: '3 bulan',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
        });

        it('should return invalid for missing start_plan', () => {
            const formData = {
                source_info: 'Instagram',
                business_type: 'F&B',
                budget: '100 juta',
            };
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
        });

        it('should merge with existing data', () => {
            const existingData = {
                source_info: 'Instagram',
                business_type: 'F&B',
                biodata: 'Budi, Jakarta',
            };
            const newData = {
                budget: '100 juta',
                start_plan: '3 bulan',
            };
            const result = validateFormData(newData, existingData);
            expect(result.valid).toBe(true);
            expect(result.parsedData).toEqual({
                biodata: 'Budi, Jakarta',
                source_info: 'Instagram',
                business_type: 'F&B',
                budget: '100 juta',
                start_plan: '3 bulan',
            });
        });

        it('should return all missing fields in errors', () => {
            const formData = {};
            const result = validateFormData(formData);
            expect(result.valid).toBe(false);
            expect(result.errors!.length).toBe(5);
        });
    });

    describe('isFormSubmission', () => {
        it('should detect form submission with multiple keywords', () => {
            expect(isFormSubmission('Saya dapat info dari instagram, ingin bisnis fnb')).toBe(true);
        });

        it('should detect form submission with budget keyword', () => {
            expect(isFormSubmission('Budget saya 100 juta untuk bisnis retail')).toBe(true);
        });

        it('should detect form submission with pattern match', () => {
            expect(isFormSubmission('Sumber: Instagram')).toBe(true);
            expect(isFormSubmission('Budget: 100 juta')).toBe(true);
        });

        it('should return false for simple greeting', () => {
            expect(isFormSubmission('Halo, selamat pagi')).toBe(false);
        });

        it('should return false for ambiguous messages', () => {
            // Messages without form keywords or patterns
            expect(isFormSubmission('Halo bagaimana kabarnya')).toBe(false);
            expect(isFormSubmission('Terima kasih banyak')).toBe(false);
        });

        it('should detect timeline keywords', () => {
            expect(isFormSubmission('Saya mau mulai bisnis fnb bulan depan')).toBe(true);
        });
    });

    describe('getMissingFieldsMessage', () => {
        it('should return empty string for no errors', () => {
            expect(getMissingFieldsMessage([])).toBe('');
        });

        it('should return string with multiple errors', () => {
            const errors = ['Field A missing', 'Field B missing'];
            const message = getMissingFieldsMessage(errors);
            expect(message).toContain('Mohon lengkapi data berikut');
            expect(message).toContain('- Field A missing');
            expect(message).toContain('- Field B missing');
        });


    });
});
