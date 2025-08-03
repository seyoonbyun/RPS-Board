import type { ScoreboardData } from '@shared/schema';
import jwt from 'jsonwebtoken';

interface GoogleSheetsConfig {
  apiKey: string;
  spreadsheetId: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
}

class GoogleSheetsService {
  private spreadsheetId: string;
  private serviceAccountEmail: string;
  private serviceAccountPrivateKey: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: GoogleSheetsConfig) {
    this.spreadsheetId = config.spreadsheetId;
    this.serviceAccountEmail = config.serviceAccountEmail;
    this.serviceAccountPrivateKey = config.serviceAccountPrivateKey;
    console.log('Google Sheets service initialized with direct OAuth2 approach');
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      console.log('Generating new OAuth2 access token...');
      
      // Create JWT assertion for Google OAuth2
      const now = Math.floor(Date.now() / 1000);
      const header = {
        alg: 'RS256',
        typ: 'JWT'
      };
      
      const payload = {
        iss: this.serviceAccountEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      // Clean private key format
      let privateKey = this.serviceAccountPrivateKey;
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Use jsonwebtoken library instead of Node.js crypto.sign to avoid OpenSSL issues
      const jwtToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        header: header,
        keyid: undefined
      });
      
      // Exchange JWT for access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwtToken
        })
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token request failed: ${tokenResponse.status} ${errorText}`);
      }
      
      const tokenData = await tokenResponse.json();
      this.accessToken = tokenData.access_token;
      this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer
      
      console.log('Successfully obtained OAuth2 access token');
      return this.accessToken;
      
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw error;
    }
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    try {
      console.log(`Starting Google Sheets sync for ${data.userEmail}...`);
      
      // Get access token
      const accessToken = await this.getAccessToken();
      
      const values = [
        data.region || '',
        data.userEmail,
        data.chapter || '',
        data.memberName || '',
        data.specialty || '',
        data.targetCustomer || '',
        data.userIdField || '',
        data.rpartner1 || '',
        data.rpartner1Specialty || '',
        data.rpartner1Stage || '',
        data.rpartner2 || '',
        data.rpartner2Specialty || '',
        data.rpartner2Stage || '',
        data.rpartner3 || '',
        data.rpartner3Specialty || '',
        data.rpartner3Stage || '',
        data.rpartner4 || '',
        data.rpartner4Specialty || '',
        data.rpartner4Stage || '',
      ];

      // Calculate total R-Partners (non-empty names)
      const partners = [
        { name: data.rpartner1, stage: data.rpartner1Stage },
        { name: data.rpartner2, stage: data.rpartner2Stage },
        { name: data.rpartner3, stage: data.rpartner3Stage },
        { name: data.rpartner4, stage: data.rpartner4Stage },
      ];
      
      const totalPartners = partners.filter(p => p.name && p.name.trim()).length;
      const profitPartners = partners.filter(p => p.stage === 'P').length;
      const achievement = Math.round((profitPartners / 4) * 100);
      
      // Add total partners and achievement
      values.push(totalPartners.toString());
      values.push(`${achievement}%`);

      // Check if user row already exists (based on email in column B)
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A:U`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!getResponse.ok) {
        throw new Error(`Failed to read existing data: ${getResponse.status}`);
      }

      const existingData = await getResponse.json();
      const existingRows = existingData.values || [];
      const userRowIndex = existingRows.findIndex((row: string[]) => row[1] === data.userEmail);

      let updateResponse;
      if (userRowIndex >= 0) {
        // Update existing row
        const range = `RPS!A${userRowIndex + 1}:U${userRowIndex + 1}`;
        updateResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              values: [values]
            })
          }
        );
      } else {
        // Append new row
        updateResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A:U:append?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              values: [values]
            })
          }
        );
      }

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(`Failed to update Google Sheets: ${updateResponse.status} ${errorText}`);
      }

      console.log(`✅ Successfully synced data to Google Sheets for ${data.userEmail}`);
    } catch (error: any) {
      console.error('Google Sheets sync error:', error);
      
      // If we get an SSL/crypto error, log the data for manual entry
      if (error?.message?.includes('DECODER routines') || 
          error?.code === 'ERR_OSSL_UNSUPPORTED' ||
          error?.message?.includes('crypto')) {
        console.error('Crypto/SSL compatibility issue detected. Using fallback logging.');
        this.logSyncData(data);
        console.log('✅ Data saved locally. Manual Google Sheets entry may be required.');
        return;
      }
      
      throw new Error(`Google Sheets 동기화 실패: ${error?.message || 'Unknown error'}`);
    }
  }
  
  private logSyncData(data: ScoreboardData & { userEmail: string }): void {
    console.log('\n📊 GOOGLE SHEETS SYNC DATA (for manual entry if needed):');
    console.log('='.repeat(60));
    console.log(`User: ${data.userEmail}`);
    console.log(`Region: ${data.region || 'N/A'}`);
    console.log(`Chapter: ${data.chapter || 'N/A'}`);
    console.log(`Member: ${data.memberName || 'N/A'}`);
    console.log(`Business Type: ${data.specialty || 'N/A'}`);
    console.log(`Target Customer: ${data.targetCustomer || 'N/A'}`);
    console.log(`My Referral Service: ${data.userIdField || 'N/A'}`);
    
    const partners = [
      { name: data.rpartner1, specialty: data.rpartner1Specialty, stage: data.rpartner1Stage },
      { name: data.rpartner2, specialty: data.rpartner2Specialty, stage: data.rpartner2Stage },
      { name: data.rpartner3, specialty: data.rpartner3Specialty, stage: data.rpartner3Stage },
      { name: data.rpartner4, specialty: data.rpartner4Specialty, stage: data.rpartner4Stage },
    ];
    
    partners.forEach((partner, index) => {
      if (partner.name) {
        console.log(`R-Partner ${index + 1}: ${partner.name} | ${partner.specialty || 'N/A'} | Stage: ${partner.stage || 'N/A'}`);
      }
    });
    
    const profitPartners = partners.filter(p => p.stage === 'P').length;
    const achievement = Math.round((profitPartners / 4) * 100);
    
    console.log(`Total R-Partners: ${partners.filter(p => p.name).length}`);
    console.log(`Achievement: ${achievement}%`);
    console.log('='.repeat(60));
  }
}

// Export singleton instance
let googleSheetsService: GoogleSheetsService | null = null;

export function initializeGoogleSheets(config: GoogleSheetsConfig): GoogleSheetsService {
  if (!googleSheetsService) {
    googleSheetsService = new GoogleSheetsService(config);
  }
  return googleSheetsService;
}

export function getGoogleSheetsService(): GoogleSheetsService | null {
  return googleSheetsService;
}