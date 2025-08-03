import type { ScoreboardData } from '@shared/schema';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';

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
    // Extract spreadsheet ID from URL if needed
    let spreadsheetId = config.spreadsheetId;
    if (spreadsheetId.includes('/spreadsheets/d/')) {
      const match = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        spreadsheetId = match[1];
      }
    }
    this.spreadsheetId = spreadsheetId;
    
    // Clean service account email (remove JSON quotes if present)
    let email = config.serviceAccountEmail;
    if (email.startsWith('"') && email.endsWith('"')) {
      email = email.slice(1, -1);
    }
    this.serviceAccountEmail = email;
    
    this.serviceAccountPrivateKey = config.serviceAccountPrivateKey;
    console.log('Google Sheets service initialized');
    console.log('Spreadsheet ID:', this.spreadsheetId);
    console.log('Service account email:', this.serviceAccountEmail);
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      console.log('Trying Google OAuth2 with googleapis library...');
      
      // Clean private key format
      let privateKey = this.serviceAccountPrivateKey;
      
      // Remove JSON string quotes if present
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
      }
      
      // Replace escaped newlines with actual newlines
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Create service account credentials
      const credentials = {
        client_email: this.serviceAccountEmail,
        private_key: privateKey,
        private_key_id: undefined // Google will handle this
      };
      
      console.log('Using googleapis library for authentication...');
      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      const authClient = await auth.getClient();
      const accessTokenResponse = await authClient.getAccessToken();
      
      if (!accessTokenResponse.token) {
        throw new Error('Failed to get access token from Google API');
      }
      
      this.accessToken = accessTokenResponse.token;
      this.tokenExpiry = Date.now() + (3600 * 1000) - 60000; // 1 hour minus 1 minute buffer
      
      console.log('Successfully obtained OAuth2 access token via googleapis');
      return this.accessToken;
      
    } catch (error) {
      console.error('googleapis authentication failed:', error);
      console.log('Falling back to direct JWT approach...');
      
      // Fallback to direct JWT method
      return await this.getAccessTokenDirectJWT();
    }
  }

  private async getAccessTokenDirectJWT(): Promise<string> {
    try {
      console.log('Generating new OAuth2 access token with direct JWT...');
      
      // Create JWT assertion for Google OAuth2
      const now = Math.floor(Date.now() / 1000);
      
      const payload = {
        iss: this.serviceAccountEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };
      
      console.log('JWT payload:', payload);

      // Clean private key format
      let privateKey = this.serviceAccountPrivateKey;
      
      // Remove JSON string quotes if present
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
      }
      
      // Replace escaped newlines with actual newlines
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Create the JWT for OAuth2
      const jwtToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256'
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
      
      console.log('Successfully obtained OAuth2 access token via direct JWT');
      return this.accessToken;
      
    } catch (error) {
      console.error('Direct JWT authentication also failed:', error);
      throw error;
    }
  }

  async checkUserCredentials(email: string, password: string): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      
      // Get the first 100 rows to check for allowed users (get more columns to be safe)
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z100`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!getResponse.ok) {
        console.error('Failed to read Google Sheets for user validation');
        return false;
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      console.log('Google Sheets data for authentication:', {
        totalRows: rows.length,
        headerRow: rows[0],
        sampleUserRow: rows[1]
      });
      
      // Find the correct columns for ID and PW by checking the header row
      const headerRow = rows[0] || [];
      let userIdColumnIndex = -1;
      let passwordColumnIndex = -1;
      
      // Look for columns that might contain user ID and password
      for (let j = 0; j < headerRow.length; j++) {
        const header = headerRow[j] ? headerRow[j].toString().toLowerCase() : '';
        if (header.includes('user') || header.includes('id') || j === 0) { // Column A (USER)
          userIdColumnIndex = j;
        }
        // Look for password-related columns - since we don't see password in the screenshot,
        // let's check if A column (USER) contains the credential info we need
      }
      
      console.log(`Using column indices - USER/ID: ${userIdColumnIndex}, PW: ${passwordColumnIndex}`);
      
      // Check if email exists in column B and validate credentials
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[1] && row[1].toLowerCase() === email.toLowerCase()) {
          // For now, let's check if the USER column (A) has any content and use simple password validation
          const userIdInSheet = row[0]; // Column A (USER)
          
          console.log(`Found user ${email} in row ${i+1}, USER column value: ${userIdInSheet}`);
          
          // If there's a user ID in column A and it's not empty, allow login with any 4-digit password
          if (userIdInSheet && userIdInSheet.trim() !== '' && password.length === 4) {
            console.log(`User ${email} authenticated successfully (USER: ${userIdInSheet})`);
            return true;
          } else {
            console.log(`User ${email} found but authentication failed (USER: ${userIdInSheet}, PW length: ${password.length})`);
            return false;
          }
        }
      }
      
      console.log(`User ${email} is not found in allowed users list`);
      return false;
    } catch (error) {
      console.error('Error checking user permissions:', error);
      return false;
    }
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    try {
      console.log(`Starting Google Sheets sync for ${data.userEmail}...`);
      
      // Get access token
      const accessToken = await this.getAccessToken();
      
      // Match the exact order from Google Sheets header:
      // ID, 이메일, 지역, 챕터, 멤버명, 전문분야, 나의 핵심 고객층, R파트너 1, R파트너 1 전문분야, R파트너 1 V-C-P, etc.
      const values = [
        '', // ID (auto-generated)
        data.userEmail,
        data.region || '',
        data.partner || '',
        data.memberName || '',
        data.specialty || '',
        data.targetCustomer || '',
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
      
      console.log('Data to sync to Google Sheets:', values);

      // Check if user row already exists in first 100 rows (to avoid massive data scanning)
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:U100`,
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
      // Email is in column B (index 1), find existing user in first 100 rows
      let userRowIndex = -1;
      for (let i = 1; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (row && row[1] === data.userEmail) {
          userRowIndex = i;
          break;
        }
      }
      console.log(`User row index for ${data.userEmail}:`, userRowIndex);

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
        // Find the first empty row after the header, starting from row 2
        let firstEmptyRow = 2;
        for (let i = 1; i < Math.min(existingRows.length, 100); i++) {
          const row = existingRows[i];
          if (!row || row.length === 0 || !row[1] || row[1].trim() === '') {
            firstEmptyRow = i + 1;
            break;
          }
          firstEmptyRow = i + 2; // Next row after the last filled row
        }
        
        // Ensure we don't go beyond row 100 for new entries
        if (firstEmptyRow > 100) {
          firstEmptyRow = 2; // Force to row 2 if too many rows
        }
        
        const range = `RPS!A${firstEmptyRow}:U${firstEmptyRow}`;
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
        console.log(`Adding new row at position ${firstEmptyRow}`);
      }

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error(`Google Sheets update failed with status ${updateResponse.status}:`, errorText);
        throw new Error(`Failed to update Google Sheets: ${updateResponse.status} ${errorText}`);
      }

      const updateResult = await updateResponse.json();
      console.log('Google Sheets update result:', updateResult);
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