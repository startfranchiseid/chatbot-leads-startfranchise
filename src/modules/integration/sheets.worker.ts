import { Job } from 'bullmq';
import { google } from 'googleapis';
import { logger } from '../../infra/logger.js';
import type { SheetsSyncJobData } from '../../infra/queue.js';

// OAuth2 client singleton
let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

/**
 * Get OAuth2 client for Google Sheets
 * Supports both OAuth2 (client ID/secret) and Service Account authentication
 */
function getGoogleAuth() {
  // Try OAuth2 first (recommended)
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    if (!oauth2Client) {
      oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
    }
    return oauth2Client;
  }

  // Fallback to Service Account
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (email && privateKey) {
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: email,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  throw new Error('Google Sheets credentials not configured. Set either OAuth2 (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) or Service Account credentials.');
}

// Get Sheets API client
function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Clean phone number - remove WhatsApp suffixes
 */
function cleanPhoneNumber(userId: string): string {
  // Remove all WhatsApp suffixes
  let phone = userId
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/@lid$/i, '');
  
  // If still has @, extract before @
  if (phone.includes('@')) {
    phone = phone.split('@')[0];
  }
  
  // Format Indonesian numbers nicely
  if (phone.startsWith('62')) {
    // Convert 628xxx to 08xxx for local format
    phone = '0' + phone.substring(2);
  }
  
  return phone;
}

/**
 * Format date to Indonesian locale
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  
  // If it's already a readable format, return as-is
  if (!dateStr.includes('T') && !dateStr.includes('-')) {
    return dateStr;
  }
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    // Format: "12 Januari 2026"
    const options: Intl.DateTimeFormatOptions = { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    };
    return date.toLocaleDateString('id-ID', options);
  } catch {
    return dateStr;
  }
}

/**
 * Sync lead form data to Google Sheets
 * Column mapping based on user's spreadsheet:
 * - nomor, sumber_info, bidang_usaha, biodata, budget, rencana_mulai
 */
export async function syncToGoogleSheets(job: Job<SheetsSyncJobData>): Promise<void> {
  const { leadId, formData, userId, source } = job.data;

  logger.info({ jobId: job.id, leadId }, 'Starting Google Sheets sync');

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Informasi Client';

    if (!spreadsheetId) {
      throw new Error('GOOGLE_SPREADSHEET_ID not configured');
    }

    // Clean and format data
    const cleanPhone = cleanPhoneNumber(userId);
    const formattedStartPlan = formatDate(formData.start_plan);

    // Prepare row data matching user's column structure:
    // nomor | sumber_info | bidang_usaha | biodata | budget | rencana_mulai
    const rowData = [
      cleanPhone,                       // nomor (clean phone number)
      formData.source_info || '',       // sumber_info
      formData.business_type || '',     // bidang_usaha
      formData.biodata || '',           // biodata (name, location, etc.)
      formData.budget || '',            // budget
      formattedStartPlan,               // rencana_mulai (formatted date)
    ];

    // Append to sheet (starting from column A, row 2+)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });

    logger.info({ jobId: job.id, leadId, userId: cleanPhone }, 'Google Sheets sync completed');
  } catch (error) {
    logger.error({ error, jobId: job.id, leadId }, 'Google Sheets sync failed');
    throw error; // Let BullMQ handle retry
  }
}

/**
 * Initialize sheet - verify connection and check headers
 */
export async function initializeSheet(): Promise<void> {
  try {
    // Check if credentials are configured
    const hasOAuth = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN;
    const hasServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY;
    
    if (!hasOAuth && !hasServiceAccount) {
      logger.warn('Google Sheets credentials not configured - run: npx tsx scripts/setup-google-oauth.ts');
      return;
    }

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Informasi Client';

    if (!spreadsheetId) {
      logger.warn('GOOGLE_SPREADSHEET_ID not configured - skipping sheet initialization');
      return;
    }

    // Test connection by reading first row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:F1`,
    });

    if (response.data.values && response.data.values.length > 0) {
      logger.info({ headers: response.data.values[0] }, 'Google Sheets connected - existing headers found');
    } else {
      logger.info('Google Sheets connected - sheet is empty');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Google Sheets');
  }
}

/**
 * Worker processor for sheets sync jobs
 */
export async function sheetsWorkerProcessor(job: Job<SheetsSyncJobData>): Promise<void> {
  await syncToGoogleSheets(job);
}
