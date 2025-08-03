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
    try {
      // Create JWT auth client  
      let privateKey = config.serviceAccountPrivateKey;
      
      // Handle different private key formats
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Additional handling for encoded private keys
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') && privateKey.length > 50) {
        // Try to decode if it's base64 encoded or just missing line breaks
        try {
          if (privateKey.startsWith('-----BEGIN')) {
            // Already in PEM format but missing line breaks
            privateKey = privateKey;
          } else {
            // Could be base64 encoded
            privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
          }
        } catch (e) {
          console.warn('Could not decode private key, using as-is');
        }
      }
      
      // Log for debugging (without exposing the key)
      console.log(`Private key format check: starts with BEGIN? ${privateKey.includes('-----BEGIN PRIVATE KEY-----')}, length: ${privateKey.length}`);
      
      // More flexible format check
      if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
        console.error('Invalid private key format. Must be in PEM format');
        throw new Error('Invalid Google Service Account private key format');
      }
      
      const jwtClient = new google.auth.JWT({
        email: config.serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Initialize Google Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: jwtClient });
      this.spreadsheetId = config.spreadsheetId;
      
      console.log('Google Sheets service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Google Sheets service:', error);
      // Don't throw error to allow app to continue running
      this.sheets = null;
      this.spreadsheetId = config.spreadsheetId;
    }
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    // Check if Google Sheets service is properly initialized
    if (!this.sheets) {
      console.warn('Google Sheets service not initialized, skipping sync');
      return;
    }
    
    try {
      // Calculate total R partners and achievement
      const profitPartners = [
        data.rpartner1Stage === 'P' ? 1 : 0,
        data.rpartner2Stage === 'P' ? 1 : 0,
        data.rpartner3Stage === 'P' ? 1 : 0,
        data.rpartner4Stage === 'P' ? 1 : 0,
      ].reduce((sum, count) => sum + count, 0);
      
      const totalPartners = [
        data.rpartner1 ? 1 : 0,
        data.rpartner2 ? 1 : 0,
        data.rpartner3 ? 1 : 0,
        data.rpartner4 ? 1 : 0,
      ].reduce((sum, count) => sum + count, 0);
      
      const achievement = Math.round((profitPartners / 4) * 100);

      // Prepare data for Google Sheets RPS sheet (A1:U1 format)  
      const row = [
        data.region || '', // 지역 (A)
        data.userEmail, // 이메일 (B)
        data.partner || '', // 챕터 (C)
        data.memberName || '', // 멤버 (D)
        data.specialty || '', // 업태명 (E)
        data.targetCustomer || '', // 타겟고객 (F)
        data.userIdField || '', // 나의 리펀 서비스 (G)
        data.rpartner1 || '', // R파트너 1 (H)
        data.rpartner1Specialty || '', // R파트너 1 : 전문분야 (I)
        data.rpartner1Stage || '', // R파트너 1 : V-C-P (J)
        data.rpartner2 || '', // R파트너 2 (K)
        data.rpartner2Specialty || '', // R파트너 2 : 전문분야 (L)
        data.rpartner2Stage || '', // R파트너 2 : V-C-P (M)
        data.rpartner3 || '', // R파트너 3 (N)
        data.rpartner3Specialty || '', // R파트너 3 : 전문분야 (O)
        data.rpartner3Stage || '', // R파트너 3 : V-C-P (P)
        data.rpartner4 || '', // R파트너 4 (Q)
        data.rpartner4Specialty || '', // R파트너 4 : 전문분야 (R)
        data.rpartner4Stage || '', // R파트너 4 : V-C-P (S)
        totalPartners, // 총 R파트너 수 (T)
        `${achievement}%`, // 달성 (U)
      ];

      // Check if header row exists, if not create it
      await this.ensureHeaderRow();

      // Find existing row for this user or append new row
      const existingRowIndex = await this.findUserRow(data.userEmail);
      
      if (existingRowIndex !== -1) {
        // Update existing row in RPS sheet (A to U columns)
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `RPS!A${existingRowIndex}:U${existingRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [row]
          }
        });
      } else {
        // Append new row in RPS sheet (A to U columns)
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'RPS!A:U',
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
      // Check if header row exists in RPS sheet A1:U1
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'RPS!A1:U1'
      });

      if (!response.data.values || response.data.values.length === 0) {
        // Create header row in RPS sheet A1:U1
        const headers = [
          '지역',
          '이메일',
          '챕터',
          '멤버',
          '업태명',
          '타겟고객',
          '나의 리펀 서비스',
          'R파트너 1',
          'R파트너 1 : 전문분야',
          'R파트너 1 : V-C-P',
          'R파트너 2',
          'R파트너 2 : 전문분야',
          'R파트너 2 : V-C-P',
          'R파트너 3',
          'R파트너 3 : 전문분야',
          'R파트너 3 : V-C-P',
          'R파트너 4',
          'R파트너 4 : 전문분야',
          'R파트너 4 : V-C-P',
          '총 R파트너 수',
          '달성'
        ];

        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'RPS!A1:U1',
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
        range: 'RPS!B:B' // Column B contains user emails in RPS sheet
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