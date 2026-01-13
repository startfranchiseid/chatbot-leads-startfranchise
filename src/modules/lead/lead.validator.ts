import { FormValidationResult, LeadFormData } from '../../types/lead.js';
import { logger } from '../../infra/logger.js';

/**
 * Form field patterns for parsing user input
 */
const FIELD_PATTERNS = {
  biodata: /(?:nama|biodata|domisili)[^:\n]*:[ \t]*(.*)$/im,
  sourceInfo: /(?:sumber|source|dari|info)[^:\n]*:[ \t]*(.*)$/im,
  businessType: /(?:jenis bisnis|business type|tipe bisnis|type of business|bisnis)[^:\n]*:[ \t]*(.*)$/im,
  budget: /(?:budget|anggaran|modal|dana)[^:\n]*:[ \t]*(.*)$/im,
  startPlan: /(?:kapan|when|mulai|start|timeline|rencana)[^:\n]*:[ \t]*(.*)$/im,
};

/**
 * Keywords that indicate form fields
 */
const FIELD_KEYWORDS = {
  sourceInfo: ['instagram', 'facebook', 'google', 'tiktok', 'youtube', 'referral', 'teman', 'iklan', 'ads', 'website', 'event'],
  businessType: ['fnb', 'f&b', 'retail', 'service', 'jasa', 'makanan', 'minuman', 'food', 'beverage', 'fashion', 'kuliner'],
  budget: ['juta', 'million', 'rp', 'idr', 'rb', 'ribu', 'thousand', 'jt', 'milyar', 'billion'], // Removed 'm' effectively
  startPlan: ['bulan', 'month', 'minggu', 'week', 'tahun', 'year', 'segera', 'asap', 'immediately', 'q1', 'q2', 'q3', 'q4'],
};

/**
 * Parse form data from user message
 */
export function parseFormData(message: string): Partial<LeadFormData> {
  const parsed: Partial<LeadFormData> = {};
  const normalizedMessage = message.toLowerCase();

  // 1. Pattern matching (Strict line-based)
  for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value) {
        const fieldName = field as keyof typeof FIELD_PATTERNS;
        const targetKey = fieldName === 'sourceInfo' ? 'source_info' :
          fieldName === 'businessType' ? 'business_type' :
            fieldName === 'startPlan' ? 'start_plan' :
              fieldName; // biodata, budget map directly

        (parsed as any)[targetKey] = value;
      }
    }
  }

  // 2. Keyword-based detection (Fallback for missing fields only)
  if (!parsed.source_info) {
    for (const keyword of FIELD_KEYWORDS.sourceInfo) {
      if (normalizedMessage.includes(keyword)) {
        parsed.source_info = extractSentenceWithKeyword(message, keyword);
        break;
      }
    }
  }

  if (!parsed.business_type) {
    for (const keyword of FIELD_KEYWORDS.businessType) {
      if (normalizedMessage.includes(keyword)) {
        parsed.business_type = extractSentenceWithKeyword(message, keyword);
        break;
      }
    }
  }

  if (!parsed.budget) {
    for (const keyword of FIELD_KEYWORDS.budget) {
      if (normalizedMessage.includes(keyword)) {
        parsed.budget = extractBudget(message);
        break;
      }
    }
  }

  if (!parsed.start_plan) {
    for (const keyword of FIELD_KEYWORDS.startPlan) {
      if (normalizedMessage.includes(keyword)) {
        parsed.start_plan = extractSentenceWithKeyword(message, keyword);
        break;
      }
    }
  }

  return parsed;
}

/**
 * Validate form data completeness
 */
export function validateFormData(
  formData: Partial<LeadFormData>,
  existingData?: Partial<LeadFormData>
): FormValidationResult {
  const mergedData = { ...existingData, ...formData };
  const errors: string[] = [];

  // Required fields check
  const requiredFields: (keyof LeadFormData)[] = [
    'biodata',
    'source_info',
    'business_type',
    'budget',
    'start_plan',
  ];

  for (const field of requiredFields) {
    if (!mergedData[field]) {
      errors.push(field);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      parsedData: mergedData,
      errors,
    };
  }

  return {
    valid: true,
    parsedData: mergedData,
  };
}

/**
 * Check if message looks like a form submission
 */
export function isFormSubmission(message: string): boolean {
  const normalizedMessage = message.toLowerCase();

  // Check if message contains any form-related keywords
  const allKeywords = [
    ...FIELD_KEYWORDS.sourceInfo,
    ...FIELD_KEYWORDS.businessType,
    ...FIELD_KEYWORDS.budget,
    ...FIELD_KEYWORDS.startPlan,
  ];

  const keywordMatches = allKeywords.filter(keyword =>
    normalizedMessage.includes(keyword)
  );

  // Consider it a form submission if it has at least 2 field indicators
  // or if it matches any field pattern
  if (keywordMatches.length >= 2) {
    return true;
  }

  for (const pattern of Object.values(FIELD_PATTERNS)) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper: Extract sentence containing keyword
 */
function extractSentenceWithKeyword(text: string, keyword: string): string {
  const sentences = text.split(/[.!?\n]/);
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
      return sentence.trim();
    }
  }
  return keyword;
}

/**
 * Helper: Extract budget from text
 */
function extractBudget(text: string): string | undefined {
  // Match patterns like "100 juta", "Rp 50.000.000", "50jt"
  const budgetPatterns = [
    /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(?:juta|jt|million|m)/i,
    /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(?:milyar|miliar|billion|b)/i,
    /(?:rp\.?\s*)(\d+(?:[.,]\d+)*)/i,
  ];

  for (const pattern of budgetPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  return undefined;
}

/**
 * Get error message for missing fields
 */
export function getMissingFieldsMessage(errors: string[]): string {
  if (errors.length === 0) return '';

  const missingList = errors.map((field) => {
    switch (field) {
      case 'biodata':
        return '- Nama & Domisili';
      case 'source_info':
        return '- Sumber informasi (Instagram/Google/dll)';
      case 'business_type':
        return '- Jenis bisnis (F&B/Retail/Jasa/dll)';
      case 'budget':
        return '- Budget/modal awal';
      case 'start_plan':
        return '- Rencana mulai (bulan/tahun)';
      default:
        return `- ${field}`;
    }
  }).join('\n');

  return `Mohon lengkapi data berikut:\n\n${missingList}\n\nSilakan kirim ulang data yang belum lengkap.`;
}
