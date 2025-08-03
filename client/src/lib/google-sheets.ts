// Google Sheets API integration
// This file contains the logic for syncing data with Google Sheets

export interface GoogleSheetsConfig {
  apiKey: string;
  spreadsheetId: string;
  range: string;
}

export class GoogleSheetsService {
  private config: GoogleSheetsConfig;

  constructor(config: GoogleSheetsConfig) {
    this.config = config;
  }

  async syncData(userData: any): Promise<boolean> {
    try {
      // TODO: Implement actual Google Sheets API integration
      // This would require:
      // 1. Google Sheets API v4
      // 2. Service account credentials
      // 3. Proper data formatting for sheet columns
      
      const apiKey = process.env.VITE_GOOGLE_SHEETS_API_KEY || this.config.apiKey;
      
      if (!apiKey) {
        throw new Error("Google Sheets API key not configured");
      }

      // Format data for Google Sheets
      const formattedData = this.formatDataForSheets(userData);
      
      // Make API call to Google Sheets
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${this.config.range}?key=${apiKey}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [formattedData]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Google Sheets API error: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error('Google Sheets sync error:', error);
      throw error;
    }
  }

  private formatDataForSheets(userData: any): string[] {
    // Format user data into array format for Google Sheets
    return [
      userData.region || '',
      userData.userIdField || '',
      userData.email || '',
      userData.partner || '',
      userData.memberName || '',
      userData.specialty || '',
      userData.targetCustomer || '',
      userData.rpartner1 || '',
      userData.rpartner1Specialty || '',
      userData.rpartner1Stage || '',
      userData.rpartner2 || '',
      userData.rpartner2Specialty || '',
      userData.rpartner2Stage || '',
      userData.rpartner3 || '',
      userData.rpartner3Specialty || '',
      userData.rpartner3Stage || '',
      userData.rpartner4 || '',
      userData.rpartner4Specialty || '',
      userData.rpartner4Stage || '',
      new Date().toLocaleString('ko-KR'), // timestamp
    ];
  }

  async readData(range: string): Promise<any[]> {
    try {
      const apiKey = process.env.VITE_GOOGLE_SHEETS_API_KEY || this.config.apiKey;
      
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${range}?key=${apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Google Sheets API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.values || [];
    } catch (error) {
      console.error('Google Sheets read error:', error);
      throw error;
    }
  }
}

// Default configuration
export const defaultGoogleSheetsConfig: GoogleSheetsConfig = {
  apiKey: process.env.VITE_GOOGLE_SHEETS_API_KEY || '',
  spreadsheetId: process.env.VITE_GOOGLE_SHEETS_ID || '',
  range: 'Sheet1!A:T', // A through T columns for all 20 fields
};

export const googleSheetsService = new GoogleSheetsService(defaultGoogleSheetsConfig);
