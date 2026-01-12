import { FormValidationResult, LeadFormData } from '../../types/lead.js';
import { logger } from '../../infra/logger.js';

/**
 * Form field patterns for parsing user input
 */
const FIELD_PATTERNS = {
  sourceInfo: /(?:sumber|source|dari mana|how did you|darimana)[\s:]*(.+)/i,
  businessType: /(?:jenis bisnis|business type|tipe bisnis|type of business|bisnis apa)[\s:]*(.+)/i,
  budget: /(?:budget|anggaran|modal|dana)[\s:]*(.+)/i,
  startPlan: /(?:kapan|when|mulai|start|timeline|rencana mulai)[\s:]*(.+)/i,
};

/**
 * Keywords that indicate form fields
 */
const FIELD_KEYWORDS = {
  sourceInfo: ['instagram', 'facebook', 'google', 'tiktok', 'youtube', 'referral', 'teman', 'iklan', 'ads', 'website', 'event'],
  businessType: ['fnb', 'f&b', 'retail', 'service', 'jasa', 'makanan', 'minuman', 'food', 'beverage', 'fashion', 'kuliner'],
  budget: ['juta', 'million', 'rp', 'idr', 'rb', 'ribu', 'thousand', 'm', 'jt', 'milyar', 'billion'],
  startPlan: ['bulan', 'month', 'minggu', 'week', 'tahun', 'year', 'segera', 'asap', 'immediately', 'q1', 'q2', 'q3', 'q4'],
};

/**
 * Parse form data from user message
 */
export function parseFormData(message: string): Partial<LeadFormData> {
  const parsed: Partial<LeadFormData> = {};
  const normalizedMessage = message.toLowerCase();

  // Try pattern matching first
  for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const fieldName = field as keyof typeof FIELD_PATTERNS;
      (parsed as Record<string, string>)[fieldName === 'sourceInfo' ? 'source_info' : 
        fieldName === 'businessType' ? 'business_type' : 
        fieldName === 'startPlan' ? 'start_plan' : fieldName] = match[1].trim();
    }
  }

  // Keyword-based detection as fallback
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
  if (!mergedData.source_info) {
    errors.push('Mohon informasikan dari mana Anda mengetahui kami (Instagram, Google, dll)');
  }

  if (!mergedData.business_type) {
    errors.push('Mohon informasikan jenis bisnis yang Anda minati');
  }

  if (!mergedData.budget) {
    errors.push('Mohon informasikan perkiraan budget/modal Anda');
  }

  if (!mergedData.start_plan) {
    errors.push('Mohon informasikan rencana waktu memulai bisnis');
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
 * Get missing fields message
 */
export function getMissingFieldsMessage(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  let message = '⚠️ Data belum lengkap. Mohon lengkapi informasi berikut:\n\n';
  errors.forEach((error, index) => {
    message += `${index + 1}. ${error}\n`;
  });
  
  message += '\nContoh format:\n';
  message += '- Sumber: Instagram\n';
  message += '- Jenis bisnis: F&B / Kuliner\n';
  message += '- Budget: 100 juta\n';
  message += '- Rencana mulai: 3 bulan lagi';

  return message;
}
