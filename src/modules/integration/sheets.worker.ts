import { Job } from 'bullmq';
import { google } from 'googleapis';
import { logger } from '../../infra/logger.js';
import type { SheetsSyncJobData } from '../../infra/queue.js';

// Google Sheets authentication
function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('Google Sheets credentials not configured');
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Get Sheets API client
function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Sync lead form data to Google Sheets
 */
export async function syncToGoogleSheets(job: Job<SheetsSyncJobData>): Promise<void> {
  const { leadId, formData, userId, source } = job.data;

  logger.info({ jobId: job.id, leadId }, 'Starting Google Sheets sync');

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Leads';

    if (!spreadsheetId) {
      throw new Error('GOOGLE_SPREADSHEET_ID not configured');
    }

    // Prepare row data
    const rowData = [
      new Date().toISOString(), // Timestamp
      userId,
      source,
      formData.source_info || '',
      formData.business_type || '',
      formData.budget || '',
      formData.start_plan || '',
      leadId,
    ];

    // Append to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });

    logger.info({ jobId: job.id, leadId }, 'Google Sheets sync completed');
  } catch (error) {
    logger.error({ error, jobId: job.id, leadId }, 'Google Sheets sync failed');
    throw error; // Let BullMQ handle retry
  }
}

/**
 * Initialize sheet with headers if empty
 */
export async function initializeSheet(): Promise<void> {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Leads';

    if (!spreadsheetId) {
      logger.warn('GOOGLE_SPREADSHEET_ID not configured - skipping sheet initialization');
      return;
    }

    // Check if sheet has headers
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:H1`,
    });

    if (!response.data.values || response.data.values.length === 0) {
      // Add headers
      const headers = [
        'Timestamp',
        'User ID',
        'Source',
        'Source Info',
        'Business Type',
        'Budget',
        'Start Plan',
        'Lead ID',
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:H1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers],
        },
      });

      logger.info('Google Sheets headers initialized');
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
