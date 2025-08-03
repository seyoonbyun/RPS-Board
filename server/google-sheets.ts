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

  async getUserProfile(email: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      
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
        throw new Error('Failed to read Google Sheets for user profile');
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // Find user row - 구글 시트의 새로운 사용자도 포함
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[0] && row[0].toLowerCase() === email.toLowerCase()) {
          console.log(`Found user profile for ${email} in row ${i+1}:`, row);
          return {
            email: row[0],
            region: row[1] || '',
            chapter: row[2] || '',
            memberName: row[3] || '',
            specialty: row[4] || '',
            targetCustomer: row[5] || '',
            // R파트너 정보 추가 - 전체 텍스트를 V-C-P로 변환
            rpartner1: row[6] || '',
            rpartner1Specialty: row[7] || '',
            rpartner1Stage: this.convertFullTextToStage(row[8] || ''),
            rpartner2: row[9] || '',
            rpartner2Specialty: row[10] || '',
            rpartner2Stage: this.convertFullTextToStage(row[11] || ''),
            rpartner3: row[12] || '',
            rpartner3Specialty: row[13] || '',
            rpartner3Stage: this.convertFullTextToStage(row[14] || ''),
            rpartner4: row[15] || '',
            rpartner4Specialty: row[16] || '',
            rpartner4Stage: this.convertFullTextToStage(row[17] || ''),
            totalPartners: row[18] || '',
            achievement: row[19] || ''
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
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
        sampleUserRow: rows[1],
        columnsCount: rows[0] ? rows[0].length : 0
      });
      
      // Find the correct columns for ID and PW by checking the header row
      const headerRow = rows[0] || [];
      let userIdColumnIndex = -1;
      let passwordColumnIndex = -1;
      
      // Look for ID and PW columns specifically
      for (let j = 0; j < headerRow.length; j++) {
        const header = headerRow[j] ? headerRow[j].toString().trim() : '';
        if (header === 'ID') {
          userIdColumnIndex = j;
        }
        if (header === 'PW') {
          passwordColumnIndex = j;
        }
      }
      
      console.log(`Using column indices - ID: ${userIdColumnIndex} (${headerRow[userIdColumnIndex]}), PW: ${passwordColumnIndex} (${headerRow[passwordColumnIndex]})`);
      
      // Check if email exists in column A (since USER column was deleted) and validate credentials
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[0] && row[0].toLowerCase() === email.toLowerCase()) {
          // Get ID and PW from the correct columns
          const userIdInSheet = userIdColumnIndex >= 0 ? row[userIdColumnIndex] : null;
          const passwordInSheet = passwordColumnIndex >= 0 ? row[passwordColumnIndex] : null;
          
          console.log(`Found user ${email} in row ${i+1}:`);
          console.log(`- ID column (${userIdColumnIndex}): ${userIdInSheet}`);
          console.log(`- PW column (${passwordColumnIndex}): ${passwordInSheet}`);
          
          // Both ID and PW must exist and PW must match exactly
          if (userIdInSheet && userIdInSheet.trim() !== '' && 
              passwordInSheet && passwordInSheet.toString() === password) {
            console.log(`User ${email} authenticated successfully (ID: ${userIdInSheet})`);
            return true;
          } else {
            console.log(`User ${email} authentication failed:`);
            console.log(`- ID present: ${!!userIdInSheet}`);
            console.log(`- PW match: ${passwordInSheet?.toString()} === ${password} ? ${passwordInSheet?.toString() === password}`);
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

  // V-C-P 단계를 전체 텍스트로 변환하는 함수
  private convertStageToFullText(stage: string): string {
    const stageMap: { [key: string]: string } = {
      'V': 'Visibility : 아는단계',
      'C': 'Credibility : 신뢰단계', 
      'P': 'Profit : 수익단계'
    };
    return stageMap[stage] || stage;
  }

  // 전체 텍스트에서 V-C-P 값을 추출하는 함수
  private convertFullTextToStage(fullText: string): string {
    if (fullText.includes('Visibility')) return 'V';
    if (fullText.includes('Credibility')) return 'C';
    if (fullText.includes('Profit')) return 'P';
    return fullText; // 기존 V, C, P 값 그대로 반환
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    try {
      console.log(`Starting Google Sheets sync for ${data.userEmail}...`);
      
      // Get access token
      const accessToken = await this.getAccessToken();
      
      // Match the exact order from Google Sheets header starting from A column:
      // 이메일, 지역, 챕터, 멤버명, 전문분야, 나의 핵심 고객층, R파트너 1, R파트너 1 전문분야, R파트너 1 V-C-P, etc.
      const values = [
        data.userEmail, // A열: 이메일
        data.region || '', // B열: 지역
        data.partner || '', // C열: 챕터
        data.memberName || '', // D열: 멤버명
        data.specialty || '', // E열: 전문분야
        data.targetCustomer || '', // F열: 나의 핵심 고객층
        data.rpartner1 || '', // G열: R파트너 1
        data.rpartner1Specialty || '', // H열: R파트너 1 전문분야
        this.convertStageToFullText(data.rpartner1Stage || ''), // I열: R파트너 1 V-C-P
        data.rpartner2 || '', // J열: R파트너 2
        data.rpartner2Specialty || '', // K열: R파트너 2 전문분야
        this.convertStageToFullText(data.rpartner2Stage || ''), // L열: R파트너 2 V-C-P
        data.rpartner3 || '', // M열: R파트너 3
        data.rpartner3Specialty || '', // N열: R파트너 3 전문분야
        this.convertStageToFullText(data.rpartner3Stage || ''), // O열: R파트너 3 V-C-P
        data.rpartner4 || '', // P열: R파트너 4
        data.rpartner4Specialty || '', // Q열: R파트너 4 전문분야
        this.convertStageToFullText(data.rpartner4Stage || ''), // R열: R파트너 4 V-C-P
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
      
      // Add total partners and achievement (S열, T열)
      values.push(totalPartners.toString()); // S열: 총 R파트너 수 (index 18)
      values.push(`${achievement}%`); // T열: 달성 (index 19)
      
      // Add ID and PW columns (U열, V열) - 기존 값 유지  
      values.push(data.userEmail); // U열: ID (index 20)
      values.push(''); // V열: PW (index 21) - 기존 값 유지
      
      console.log('Data to sync to Google Sheets (with full stage text):', values);

      // Check if user row already exists in first 100 rows (to avoid massive data scanning)
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:V100`,
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
      
      // Email is now in column A (index 0) after A column deletion
      let userRowIndex = -1;
      for (let i = 1; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (row && row[0] && row[0].toLowerCase() === data.userEmail.toLowerCase()) {
          userRowIndex = i;
          console.log(`Found existing user ${data.userEmail} in row ${userRowIndex + 1} (0-based index: ${userRowIndex})`);
          break;
        }
      }
      
      if (userRowIndex === -1) {
        console.log(`User ${data.userEmail} not found in existing rows - will add as new user`);
      }

      let updateResponse;
      if (userRowIndex >= 0) {
        // Update existing row - 기존 PW와 기본 정보 값 유지
        const existingRow = existingRows[userRowIndex];
        
        // 기존 값들 유지 (기본 정보는 구글 시트에서 가져온 값 우선)
        if (existingRow) {
          // 기본 정보는 구글 시트 값 유지하되 앱에서 업데이트된 파트너 정보는 반영
          values[0] = existingRow[0] || data.userEmail; // 이메일
          values[1] = existingRow[1] || data.region || ''; // 지역
          values[2] = existingRow[2] || data.partner || ''; // 챕터
          values[3] = existingRow[3] || data.memberName || ''; // 멤버명
          values[4] = existingRow[4] || data.specialty || ''; // 전문분야
          values[5] = existingRow[5] || data.targetCustomer || ''; // 나의 핵심 고객층
          
          // 파트너 정보는 앱에서 온 최신 데이터 사용 (index 6-17)
          // 총 R파트너 수와 달성율은 새로 계산된 값 사용 (index 18-19)
          
          // PW 값 유지 (V열, index 21)
          const existingPW = existingRow[21] ? existingRow[21] : '';
          values[21] = existingPW;
        }
        
        const range = `RPS!A${userRowIndex + 1}:V${userRowIndex + 1}`;
        console.log(`Updating existing user ${data.userEmail} in row ${userRowIndex + 1} with range ${range}`);
        console.log(`Values to update:`, values);
        
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
        
        const range = `RPS!A${firstEmptyRow}:V${firstEmptyRow}`;
        console.log(`Adding new user ${data.userEmail} in row ${firstEmptyRow} with range ${range}`);
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