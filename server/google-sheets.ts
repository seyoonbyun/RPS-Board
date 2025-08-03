import { google } from 'googleapis';
import type { ScoreboardData } from '@shared/schema';

interface GoogleSheetsConfig {
  apiKey: string;
  spreadsheetId: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
}

class GoogleSheetsService {
  private sheets: any;
  private spreadsheetId: string;

  constructor(config: GoogleSheetsConfig) {
    // Create JWT auth client
    const jwtClient = new google.auth.JWT({
      email: config.serviceAccountEmail,
      key: config.serviceAccountPrivateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Initialize Google Sheets API
    this.sheets = google.sheets({ version: 'v4', auth: jwtClient });
    this.spreadsheetId = config.spreadsheetId;
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    try {
      // Prepare data for Google Sheets
      const row = [
        new Date().toISOString(), // 타임스탬프
        data.userEmail, // 사용자 이메일
        data.region || '', // 지역
        data.userIdField || '', // ID
        data.partner || '', // 파트너
        data.memberName || '', // 멤버명
        data.specialty || '', // 전문분야
        data.targetCustomer || '', // 핵심 고객층
        data.rpartner1 || '', // R파트너1
        data.rpartner1Specialty || '', // R파트너1 전문분야
        data.rpartner1Stage || '', // R파트너1 단계
        data.rpartner2 || '', // R파트너2
        data.rpartner2Specialty || '', // R파트너2 전문분야
        data.rpartner2Stage || '', // R파트너2 단계
        data.rpartner3 || '', // R파트너3
        data.rpartner3Specialty || '', // R파트너3 전문분야
        data.rpartner3Stage || '', // R파트너3 단계
        data.rpartner4 || '', // R파트너4
        data.rpartner4Specialty || '', // R파트너4 전문분야
        data.rpartner4Stage || '', // R파트너4 단계
      ];

      // Check if header row exists, if not create it
      await this.ensureHeaderRow();

      // Find existing row for this user or append new row
      const existingRowIndex = await this.findUserRow(data.userEmail);
      
      if (existingRowIndex !== -1) {
        // Update existing row
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `Sheet1!A${existingRowIndex}:K${existingRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [row]
          }
        });
      } else {
        // Append new row
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'Sheet1!A:K',
          valueInputOption: 'RAW',
          requestBody: {
            values: [row]
          }
        });
      }

      console.log(`Successfully synced data to Google Sheets for ${data.userEmail}`);
    } catch (error: any) {
      console.error('Google Sheets sync error:', error);
      throw new Error(`Google Sheets 동기화 실패: ${error?.message || 'Unknown error'}`);
    }
  }

  private async ensureHeaderRow(): Promise<void> {
    try {
      // Check if first row has headers
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Sheet1!A1:X1'
      });

      if (!response.data.values || response.data.values.length === 0) {
        // Create header row
        const headers = [
          '타임스탬프', '사용자 이메일', '지역', 'ID', '파트너', '멤버명', '전문분야', '핵심 고객층',
          'R파트너1', 'R파트너1 전문분야', 'R파트너1 단계',
          'R파트너2', 'R파트너2 전문분야', 'R파트너2 단계',
          'R파트너3', 'R파트너3 전문분야', 'R파트너3 단계',
          'R파트너4', 'R파트너4 전문분야', 'R파트너4 단계'
        ];

        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'Sheet1!A1:K1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [headers]
          }
        });
      }
    } catch (error) {
      console.error('Error ensuring header row:', error);
    }
  }

  private async findUserRow(userEmail: string): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Sheet1!B:B' // Column B contains user emails
      });

      if (response.data.values) {
        for (let i = 0; i < response.data.values.length; i++) {
          if (response.data.values[i][0] === userEmail) {
            return i + 1; // Return 1-indexed row number
          }
        }
      }
      return -1; // User not found
    } catch (error) {
      console.error('Error finding user row:', error);
      return -1;
    }
  }
}

// Create and export Google Sheets service instance
const googleSheetsConfig: GoogleSheetsConfig = {
  apiKey: process.env.GOOGLE_SHEETS_API_KEY!,
  spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
  serviceAccountPrivateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!,
};

export const googleSheetsService = new GoogleSheetsService(googleSheetsConfig);