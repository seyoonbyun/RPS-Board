import type { ScoreboardData } from './schema.js';
import { SHEET_COLUMN_INDICES, BUSINESS_CONFIG } from './constants.js';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { requestQueue } from './request-queue.js';

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

      // Reconstruct PEM format if newlines are missing entirely
      if (!privateKey.includes('\n')) {
        const begin = '-----BEGIN PRIVATE KEY-----';
        const end = '-----END PRIVATE KEY-----';
        let body = privateKey.replace(begin, '').replace(end, '').replace(/\s/g, '');
        const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
        privateKey = `${begin}\n${wrapped}\n${end}\n`;
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

      // Reconstruct PEM format if newlines are missing entirely
      if (!privateKey.includes('\n')) {
        const begin = '-----BEGIN PRIVATE KEY-----';
        const end = '-----END PRIVATE KEY-----';
        let body = privateKey.replace(begin, '').replace(end, '').replace(/\s/g, '');
        const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
        privateKey = `${begin}\n${wrapped}\n${end}\n`;
      }
      
      // Create the JWT for OAuth2
      const jwtToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256'
      });
      
      // Exchange JWT for access token
      const tokenResponse = await fetch(process.env.GOOGLE_OAUTH2_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
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
      return this.accessToken || '';
      
    } catch (error) {
      console.error('Direct JWT authentication also failed:', error);
      throw error;
    }
  }

  async getUserProfile(email: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      
      // 요청 큐를 통해 처리하여 동시 접속 문제 해결
      const getResponse = await requestQueue.enqueue(
        `getUserProfile-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
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
          
          // R파트너 정보 수집 및 정규화
          const rpartner1 = row[8] || '';
          const rpartner1Stage = this.normalizeStage(row[10] || '');
          const rpartner2 = row[11] || '';
          const rpartner2Stage = this.normalizeStage(row[13] || '');
          const rpartner3 = row[14] || '';
          const rpartner3Stage = this.normalizeStage(row[16] || '');
          const rpartner4 = row[17] || '';
          const rpartner4Stage = this.normalizeStage(row[19] || '');
          
          // 실시간 U/V열 계산
          const partners = [
            { name: rpartner1, stage: rpartner1Stage },
            { name: rpartner2, stage: rpartner2Stage },
            { name: rpartner3, stage: rpartner3Stage },
            { name: rpartner4, stage: rpartner4Stage },
          ];
          
          const profitPartners = partners.filter(p => 
            p.name && p.name.trim() !== '' && p.stage?.includes('Profit')
          ).length;
          const calculatedAchievement = Math.round((profitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
          
          const currentUValue = row[20] || '';
          const currentVValue = row[21] || '';
          const expectedUValue = profitPartners.toString();
          const expectedVValue = `${calculatedAchievement}%`;
          
          console.log(`🔍 U/V열 실시간 검증 for ${email}:`, {
            partners: partners.map(p => `${p.name} (${p.stage})`),
            profitPartners,
            currentUV: `U="${currentUValue}", V="${currentVValue}"`,
            expectedUV: `U="${expectedUValue}", V="${expectedVValue}"`,
            needsUpdate: currentUValue !== expectedUValue || currentVValue !== expectedVValue
          });
          
          // U/V열이 실제 파트너 데이터와 맞지 않으면 자동 업데이트
          if (currentUValue !== expectedUValue || currentVValue !== expectedVValue) {
            console.log(`🔄 AUTO-UPDATING U/V columns for ${email}: ${currentUValue},${currentVValue} → ${expectedUValue},${expectedVValue}`);
            
            // 구글 시트에 올바른 U/V열 값 업데이트 (큐를 통해 처리하여 동시 접속 문제 해결)
            try {
              const accessToken = await this.getAccessToken();
              const updateRange = `RPS!U${i+1}:V${i+1}`;
              
              // 요청 큐를 통해 처리하고 사용자별 락 사용
              const updateResponse = await requestQueue.enqueue(
                `getUserProfile-autoUpdateUV-${email}`,
                async () => await fetch(
                  `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`,
                  {
                    method: 'PUT',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      values: [[parseInt(expectedUValue), expectedVValue]]
                    })
                  }
                ),
                `user:${email}` // 사용자별 락 키
              );
              
              if (updateResponse.ok) {
                console.log(`✅ Successfully updated U/V columns for ${email} to ${expectedUValue},${expectedVValue}`);
              } else {
                console.error(`❌ Failed to update U/V columns for ${email}:`, await updateResponse.text());
              }
            } catch (updateError) {
              console.error(`❌ Error updating U/V columns for ${email}:`, updateError);
            }
          }
          
          return {
            email: row[0],
            region: row[1] || '',
            chapter: row[2] || '',
            memberName: row[3] || '',
            industry: row[4] || '', // 산업군 (read-only from Google Sheets) - index 4: "디자인"
            company: row[5] || '', // 회사 (read-only from Google Sheets) - index 5: "조이풀"
            specialty: row[6] || '', // 전문분야 (bidirectional sync) - index 6: "전문분야"
            targetCustomer: row[7] || '', // 나의 핵심 고객층 (bidirectional sync) - index 7: "나의 핵심 고객층"
            // R파트너 정보 추가 - 전체 텍스트를 V-C-P로 변환
            rpartner1: rpartner1, // index 8: " R파트너 1"
            rpartner1Specialty: row[9] || '', // index 9: " R파트너 1 : 전문분야 "
            rpartner1Stage: rpartner1Stage, // index 10: " R파트너 1 : V-C-P"
            rpartner2: rpartner2, // index 11: "R파트너 2"
            rpartner2Specialty: row[12] || '', // index 12: " R파트너 2 :  전문분야 "
            rpartner2Stage: rpartner2Stage, // index 13: " R파트너 2 : V-C-P"
            rpartner3: rpartner3, // index 14: "R파트너 3"
            rpartner3Specialty: row[15] || '', // index 15: " R파트너 3 : 전문분야 "
            rpartner3Stage: rpartner3Stage, // index 16: " R파트너 3 : V-C-P"
            rpartner4: rpartner4, // index 17: "R파트너 4"
            rpartner4Specialty: row[18] || '', // index 18: " R파트너 4 : 전문분야 "
            rpartner4Stage: rpartner4Stage, // index 19: " R파트너 4 : V-C-P"
            totalPartners: expectedUValue, // 실시간 계산된 값 사용
            achievement: expectedVValue, // 실시간 계산된 값 사용
            auth: row[SHEET_COLUMN_INDICES.AUTH] || '' // AUTH 컬럼
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
      
      // 동적 사용자 관리를 위해 전체 시트 데이터 조회 (최대 5000행)
      // 요청 큐를 통해 처리하여 동시 접속 문제 해결
      const getResponse = await requestQueue.enqueue(
        `checkUserCredentials-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!getResponse.ok) {
        console.error('Failed to read Google Sheets for user validation');
        return false;
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      console.log('🔍 Dynamic user management - Google Sheets data scan:', {
        totalRows: rows.length,
        headerRow: rows[0],
        activeUsers: rows.slice(1).filter((row: any) => row && row[0] && row[0].trim()).length,
        columnsCount: rows[0] ? rows[0].length : 0
      });
      
      // 헤더 행에서 ID, PW, STATUS, AUTH 컬럼 동적 감지
      const headerRow = rows[0] || [];
      let userIdColumnIndex = -1;
      let passwordColumnIndex = -1;
      let statusColumnIndex = -1;
      let authColumnIndex = -1;
      
      // ID, PW, STATUS, AUTH 컬럼 찾기 (대소문자 무관, 공백 허용)
      for (let j = 0; j < headerRow.length; j++) {
        const header = headerRow[j] ? headerRow[j].toString().trim().toUpperCase() : '';
        if (header === 'ID') {
          userIdColumnIndex = j;
        }
        if (header === 'PW') {
          passwordColumnIndex = j;
        }
        if (header === 'STATUS') {
          statusColumnIndex = j;
        }
        if (header === 'AUTH') {
          authColumnIndex = j;
        }
      }
      
      if (userIdColumnIndex === -1 || passwordColumnIndex === -1) {
        console.error('❌ Critical: ID or PW column not found in Google Sheets');
        console.error('Available headers:', headerRow);
        return false;
      }
      
      console.log(`✅ Column detection - ID: ${userIdColumnIndex} (${headerRow[userIdColumnIndex]}), PW: ${passwordColumnIndex} (${headerRow[passwordColumnIndex]}), STATUS: ${statusColumnIndex} (${statusColumnIndex >= 0 ? headerRow[statusColumnIndex] : 'NOT FOUND'}), AUTH: ${authColumnIndex} (${authColumnIndex >= 0 ? headerRow[authColumnIndex] : 'NOT FOUND'})`);
      
      // 모든 행에서 사용자 검색 (빈 행 스킵)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // 빈 행이나 이메일이 없는 행은 스킵
        if (!row || !row[0] || !row[0].toString().trim()) {
          continue;
        }
        
        const emailInSheet = row[0].toString().trim().toLowerCase();
        if (emailInSheet === email.toLowerCase()) {
          // ID, PW, STATUS, AUTH 값 검증
          const userIdInSheet = userIdColumnIndex >= 0 && row[userIdColumnIndex] ? 
            row[userIdColumnIndex].toString().trim() : null;
          const passwordInSheet = passwordColumnIndex >= 0 && row[passwordColumnIndex] ? 
            row[passwordColumnIndex].toString() : null;
          const statusInSheet = statusColumnIndex >= 0 && row[statusColumnIndex] ? 
            row[statusColumnIndex].toString().trim() : '활동중';
          const authInSheet = authColumnIndex >= 0 && row[authColumnIndex] ? 
            row[authColumnIndex].toString().trim() : '';
          
          console.log(`🔍 Found user ${email} in row ${i+1}:`);
          console.log(`- Email: ${emailInSheet}`);
          console.log(`- ID: ${userIdInSheet ? '✓' : '✗'}`);
          console.log(`- PW: ${passwordInSheet ? '✓' : '✗'}`);
          console.log(`- STATUS: ${statusInSheet}`);
          console.log(`- AUTH: ${authInSheet || 'NONE'}`);
          
          // 탈퇴한 사용자는 로그인 차단
          if (statusInSheet === '탈퇴') {
            console.log(`❌ User ${email} is withdrawn (STATUS: 탈퇴) - login blocked`);
            throw new Error('WITHDRAWN_USER');
          }
          
          // 사용자 인증: ID와 PW 모두 존재하고 PW가 일치해야 함
          if (userIdInSheet && userIdInSheet !== '' && 
              passwordInSheet && passwordInSheet === password) {
            console.log(`✅ User ${email} authenticated successfully (Row: ${i+1})`);
            return true;
          } else {
            console.log(`❌ User ${email} authentication failed:`);
            console.log(`- ID present: ${!!userIdInSheet}`);
            console.log(`- PW match: ${passwordInSheet === password}`);
            return false;
          }
        }
      }
      
      console.log(`❌ User ${email} not found in Google Sheets user list`);
      return false;
      
    } catch (error) {
      console.error('❌ Error during user credential check:', error);
      return false;
    }
  }

  async getUserAuth(email: string): Promise<string | null> {
    try {
      const response = await requestQueue.enqueue(
        `getUserAuth-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A:Z?access_token=${this.accessToken}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          }
        )
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const rows = data.values || [];
      
      // 헤더 행에서 AUTH 컬럼 찾기
      const headerRow = rows[0] || [];
      let authColumnIndex = -1;
      
      for (let j = 0; j < headerRow.length; j++) {
        const header = headerRow[j] ? headerRow[j].toString().trim().toUpperCase() : '';
        if (header === 'AUTH') {
          authColumnIndex = j;
          break;
        }
      }
      
      if (authColumnIndex === -1) {
        return null;
      }
      
      // 사용자 검색하여 AUTH 값 반환
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || !row[0] || !row[0].toString().trim()) {
          continue;
        }
        
        const emailInSheet = row[0].toString().trim().toLowerCase();
        if (emailInSheet === email.toLowerCase()) {
          const authInSheet = authColumnIndex >= 0 && row[authColumnIndex] ? 
            row[authColumnIndex].toString().trim() : '';
          
          return authInSheet || null;
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('Error getting user auth:', error);
      return null;
    }
  }

  // Admin 시트에서 관리자 인증 확인 (별도 시트 관리)
  // found: 이메일이 Admin 시트에 존재하는지
  // valid: 비밀번호가 일치하는지
  // auth: 권한 (Admin, Growth 등)
  async checkAdminSheetCredentials(email: string, password: string): Promise<{ found: boolean; valid: boolean; auth: string | null }> {
    try {
      console.log(`🔐 Checking Admin sheet for ${email}...`);
      
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        `checkAdminSheet-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Admin!A:E?access_token=${accessToken}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          }
        )
      );
      
      if (!response.ok) {
        console.log('Admin sheet not found or not accessible');
        return { found: false, valid: false, auth: null };
      }
      
      const data = await response.json();
      const rows = data.values || [];
      
      if (rows.length < 2) {
        console.log('Admin sheet is empty');
        return { found: false, valid: false, auth: null };
      }
      
      // Admin 시트 구조: 지역명(A), 담당자명(B), ID/이메일(C), PW/비밀번호(D), AUTH/권한(E)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[2]) continue; // C열(이메일)이 없으면 스킵
        
        const emailInSheet = row[2].toString().trim().toLowerCase(); // C열: ID/이메일
        const passwordInSheet = row[3]?.toString().trim() || ''; // D열: PW/비밀번호
        const rawAuth = row[4]?.toString().trim() || 'Admin'; // E열: AUTH/권한
        
        // 권한 정규화: 대소문자 구분 없이 처리
        const normalizedAuth = rawAuth.charAt(0).toUpperCase() + rawAuth.slice(1).toLowerCase();
        const authInSheet = ['Admin', 'Growth', 'National'].includes(normalizedAuth) ? normalizedAuth : 'Admin';
        
        if (emailInSheet === email.toLowerCase()) {
          console.log(`✅ Found admin ${email} in Admin sheet with auth: ${authInSheet}`);
          
          if (passwordInSheet === password) {
            console.log(`✅ Admin ${email} password verified`);
            return { found: true, valid: true, auth: authInSheet };
          } else {
            console.log(`❌ Admin ${email} password mismatch (found in Admin sheet but wrong password)`);
            return { found: true, valid: false, auth: null };
          }
        }
      }
      
      console.log(`📋 ${email} not found in Admin sheet`);
      return { found: false, valid: false, auth: null };
      
    } catch (error) {
      console.error('Error checking Admin sheet:', error);
      return { found: false, valid: false, auth: null };
    }
  }

  // Admin 시트에서 권한만 확인 (로그인 후 권한 체크용)
  async getAdminSheetAuth(email: string): Promise<string | null> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        `getAdminSheetAuth-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Admin!A:C?access_token=${accessToken}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          }
        )
      );
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      const rows = data.values || [];
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        
        const emailInSheet = row[0].toString().trim().toLowerCase();
        if (emailInSheet === email.toLowerCase()) {
          return row[2]?.toString().trim() || 'Admin';
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting admin sheet auth:', error);
      return null;
    }
  }

  // Admin 시트에 새 관리자 추가
  async addAdminToSheet(region: string, memberName: string, email: string, password: string, auth: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`📝 Adding admin to Admin sheet: ${email}`);
      
      const accessToken = await this.getAccessToken();
      
      // Admin 시트 구조: 지역명(A), 담당자명(B), ID/이메일(C), PW/비밀번호(D), AUTH/권한(E)
      const values = [[region, memberName, email, password, auth]];
      
      const response = await requestQueue.enqueue(
        `addAdmin-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Admin!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&access_token=${accessToken}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values })
          }
        )
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to add admin:', errorText);
        return { success: false, message: 'Admin 시트에 관리자 추가 실패' };
      }
      
      console.log(`✅ Admin ${email} added successfully to Admin sheet`);
      return { success: true };
      
    } catch (error: any) {
      console.error('Error adding admin to sheet:', error);
      return { success: false, message: error.message || '관리자 추가 중 오류 발생' };
    }
  }

  async checkAdminPermission(email: string): Promise<boolean> {
    try {
      console.log(`🔐 Checking admin permission for ${email}...`);
      
      // 먼저 Admin 시트에서 확인
      const adminSheetAuth = await this.getAdminSheetAuth(email);
      if (adminSheetAuth) {
        console.log(`✅ ${email} found in Admin sheet with auth: ${adminSheetAuth}`);
        return true;
      }
      
      // Admin 시트에 없으면 RPS 시트에서 확인
      const response = await requestQueue.enqueue(
        `checkAdminPermission-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A:Z?access_token=${this.accessToken}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          }
        )
      );

      if (!response.ok) {
        console.error('Failed to read Google Sheets for admin permission check');
        return false;
      }

      const data = await response.json();
      const rows = data.values || [];
      
      // 헤더 행에서 AUTH 컬럼 찾기
      const headerRow = rows[0] || [];
      let authColumnIndex = -1;
      
      for (let j = 0; j < headerRow.length; j++) {
        const header = headerRow[j] ? headerRow[j].toString().trim().toUpperCase() : '';
        if (header === 'AUTH') {
          authColumnIndex = j;
          break;
        }
      }
      
      if (authColumnIndex === -1) {
        console.log(`❌ AUTH column not found for admin permission check`);
        return false;
      }
      
      // 사용자 검색
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || !row[0] || !row[0].toString().trim()) {
          continue;
        }
        
        const emailInSheet = row[0].toString().trim().toLowerCase();
        if (emailInSheet === email.toLowerCase()) {
          const authInSheet = authColumnIndex >= 0 && row[authColumnIndex] ? 
            row[authColumnIndex].toString().trim() : '';
          
          const isAdmin = authInSheet === 'Admin' || authInSheet === 'Growth' || authInSheet === 'National';
          console.log(`🔐 Admin permission for ${email}: ${isAdmin ? '✅ GRANTED' : '❌ DENIED'} (AUTH: "${authInSheet}")`);
          return isAdmin;
        }
      }
      
      console.log(`❌ User ${email} not found for admin permission check`);
      return false;
      
    } catch (error) {
      console.error('❌ Error during admin permission check:', error);
      return false;
    }
  }

  // 단계 정규화 함수 - 모든 형태를 긴 형태로 통일
  private normalizeStage(stage: string): string {
    if (!stage || stage === 'none') return '';
    
    // 이미 긴 형태라면 그대로 반환
    if (stage.includes(' : ')) return stage;
    
    // 짧은 형태를 긴 형태로 변환
    const stageMap: { [key: string]: string } = {
      'V': 'Visibility : 아는단계',
      'C': 'Credibility : 신뢰단계', 
      'P': 'Profit : 수익단계'
    };
    
    return stageMap[stage] || stage;
  }

  // 하위 호환성을 위한 기존 함수명 유지 (deprecated)
  private convertStageToFullText(stage: string): string {
    return this.normalizeStage(stage);
  }

  async addNewUser(userData: {
    email: string;
    region: string;
    chapter: string;
    memberName: string;
    industry: string;
    company: string;
    specialty: string;
    targetCustomer: string;
    password?: string;
    auth?: string;
  }): Promise<void> {
    return requestQueue.enqueue(
      `addNewUser-${userData.email}`,
      async () => {
        try {
          console.log(`🆕 Adding new user to Google Sheets: ${userData.email}`, {
            password: userData.password || '1234',
            auth: userData.auth || 'Member'
          });
          
          // Get access token
          const accessToken = await this.getAccessToken();
          
          // Check if user already exists - direct fetch call
          const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
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
          
          // Check for existing user
          for (let i = 1; i < existingRows.length; i++) {
            const row = existingRows[i];
            if (row && row[0] && row[0].toString().toLowerCase() === userData.email.toLowerCase()) {
              throw new Error(`User ${userData.email} already exists`);
            }
          }
          
          // Find first available row
          let targetRowIndex = existingRows.length;
          for (let i = 1; i < existingRows.length; i++) {
            const row = existingRows[i];
            if (!row || !row[0] || !row[0].toString().trim()) {
              targetRowIndex = i;
              break;
            }
          }
          
          // Create new user row with all required columns
          const newUserData = [
            userData.email,           // A: 이메일
            userData.region,          // B: 지역  
            userData.chapter,         // C: 챕터
            userData.memberName,      // D: 멤버명
            userData.industry,        // E: 산업군
            userData.company,         // F: 회사
            userData.specialty,       // G: 전문분야
            userData.targetCustomer,  // H: 나의 핵심 고객층
            '',                       // I: R파트너 1
            '',                       // J: R파트너 1 전문분야
            '',                       // K: R파트너 1 V-C-P
            '',                       // L: R파트너 2
            '',                       // M: R파트너 2 전문분야
            '',                       // N: R파트너 2 V-C-P
            '',                       // O: R파트너 3
            '',                       // P: R파트너 3 전문분야
            '',                       // Q: R파트너 3 V-C-P
            '',                       // R: R파트너 4
            '',                       // S: R파트너 4 전문분야
            '',                       // T: R파트너 4 V-C-P
            '0',                      // U: 총 R파트너 수
            '0%',                     // V: 달성
            userData.email,           // W: ID (index 22)
            userData.password || '1234', // X: PW (index 23)
            '활동중',                 // Y: STATUS (index 24)
            userData.auth || 'Member' // Z: AUTH (index 25)
          ];

          console.log(`📝 Writing data to row ${targetRowIndex + 1}:`, {
            email: newUserData[0],      // A: 이메일
            specialty: newUserData[6],  // G: 전문분야 (should be empty)
            password: newUserData[SHEET_COLUMN_INDICES.PASSWORD],  // X: PW
            auth: newUserData[SHEET_COLUMN_INDICES.AUTH],      // Z: AUTH
            fullDataLength: newUserData.length
          });
          
          console.log(`🔍 Specialty column verification:`, {
            specialtyValue: userData.specialty,
            specialtyInArray: newUserData[6],
            isSpecialtyEmpty: userData.specialty === '',
            actualSpecialtyColumnIndex: 6
          });

          const range = `RPS!A${targetRowIndex + 1}:Z${targetRowIndex + 1}`;
          
          // Direct fetch call for update
          const updateResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                values: [newUserData]
              })
            }
          );

          if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(`Failed to add user: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
          }

          console.log(`✅ Successfully added user ${userData.email} to row ${targetRowIndex + 1}`);
          
        } catch (error) {
          console.error(`❌ Error adding user ${userData.email}:`, error);
          throw error;
        }
      },
      `user:${userData.email}` // lockKey for atomicity
    );
  }

  async syncScoreboardData(data: ScoreboardData & { userEmail: string }): Promise<void> {
    return requestQueue.enqueue(
      `syncScoreboardData-${data.userEmail}`,
      async () => {
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
          data.industry || '', // E열: 산업군 (read-only from Google Sheets)
          data.company || '', // F열: 회사 (read-only from Google Sheets)
          data.specialty || '', // G열: 전문분야 (bidirectional sync)
          data.targetCustomer || '', // H열: 나의 핵심 고객층 (bidirectional sync)
          data.rpartner1 || '', // I열: R파트너 1 (index 8)
          data.rpartner1Specialty || '', // J열: R파트너 1 전문분야 (index 9)
          this.normalizeStage(data.rpartner1Stage || ''), // K열: R파트너 1 V-C-P (index 10)
          data.rpartner2 || '', // L열: R파트너 2 (index 11)
          data.rpartner2Specialty || '', // M열: R파트너 2 전문분야 (index 12)
          this.normalizeStage(data.rpartner2Stage || ''), // N열: R파트너 2 V-C-P (index 13)
          data.rpartner3 || '', // O열: R파트너 3 (index 14)
          data.rpartner3Specialty || '', // P열: R파트너 3 전문분야 (index 15)
          this.normalizeStage(data.rpartner3Stage || ''), // Q열: R파트너 3 V-C-P (index 16)
          data.rpartner4 || '', // R열: R파트너 4 (index 17)
          data.rpartner4Specialty || '', // S열: R파트너 4 전문분야 (index 18)
          this.normalizeStage(data.rpartner4Stage || ''), // T열: R파트너 4 V-C-P (index 19)
        ];

        // Calculate total R-Partners (non-empty names)
        const partners = [
          { name: data.rpartner1, stage: data.rpartner1Stage },
          { name: data.rpartner2, stage: data.rpartner2Stage },
          { name: data.rpartner3, stage: data.rpartner3Stage },
          { name: data.rpartner4, stage: data.rpartner4Stage },
        ];
        
        // 달성률 계산 - 이름이 있고 Profit 단계인 파트너만 카운트 (긴 형태 통일)
        const profitPartners = partners.filter(p => 
          p.name && p.name.trim() !== '' && p.stage === 'Profit : 수익단계'
        ).length;
        const achievement = Math.round((profitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
        
        console.log(`📊 Achievement calculation for ${data.userEmail}:`, {
          allPartners: partners,
          profitPartners,
          achievement: `${achievement}%`,
          partnerDetails: partners.map((p, i) => `Partner ${i+1}: "${p.name}" (${p.stage})`),
          uColumnValue: profitPartners.toString(), // U열에 저장될 값
          vColumnValue: `${achievement}%` // V열에 저장될 값
        });
        
        // Add total partners and achievement (U열, V열) - 모든 챕터 정상 적용
        values.push(profitPartners.toString()); // U열: 총 R파트너 수 - 문자열로 (index 20)
        values.push(`${achievement}%`); // V열: 달성 (index 21)
        
        // Add ID, PW and STATUS columns (W열, X열, Y열) - 기존 값 유지  
        values.push(data.userEmail); // W열: ID (index 22)
        // PW 필드는 나중에 기존 값으로 교체할 것이므로 일단 placeholder 추가
        values.push('PRESERVE_EXISTING_PW'); // X열: PW (index 23) - 기존 값 유지
        values.push('활동중'); // Y열: STATUS (index 24) - 기본값
        
        console.log('Data to sync to Google Sheets (with full stage text):', values);

        // 동적 사용자 관리: 전체 시트에서 사용자 검색 (PW와 STATUS 포함해서 Y열까지, 최대 5000행)
        // Direct fetch call
        const getResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Y5000`,
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
      
      console.log(`🔍 Scanning ${existingRows.length} rows for user ${data.userEmail}...`);
      
      // 사용자 행 검색 (빈 행 및 삭제된 사용자 고려)
      let userRowIndex = -1;
      let availableEmptyRows: number[] = [];
      
      for (let i = 1; i < existingRows.length; i++) {
        const row = existingRows[i];
        
        // 빈 행 또는 삭제된 행 감지
        if (!row || !row[0] || !row[0].toString().trim()) {
          availableEmptyRows.push(i);
          continue;
        }
        
        // 사용자 이메일 매칭 (대소문자 무관)
        if (row[0].toString().trim().toLowerCase() === data.userEmail.toLowerCase()) {
          userRowIndex = i;
          console.log(`✅ Found existing user ${data.userEmail} in row ${userRowIndex + 1} (0-based index: ${userRowIndex})`);
          break;
        }
      }
      
      if (userRowIndex === -1) {
        console.log(`🆕 User ${data.userEmail} not found - will add as new user`);
        console.log(`📍 Available empty rows: ${availableEmptyRows.slice(0, 5).map(r => r + 1)}`);
      }

      let updateResponse;
      if (userRowIndex >= 0) {
        // Update existing row - 기존 PW와 기본 정보 값 유지
        const existingRow = existingRows[userRowIndex];
        
        // 기존 값들 유지 (기본 정보는 구글 시트에서 가져온 값 우선)
        if (existingRow) {
          // 기본 정보는 구글 시트 값 유지하되 앱에서 업데이트된 파트너 정보는 반영
          values[0] = existingRow[0] || data.userEmail; // 이메일
          values[1] = existingRow[1] || data.region || ''; // 지역 (구글 시트 우선)
          values[2] = existingRow[2] || data.partner || ''; // 챕터 (구글 시트 우선)
          values[3] = existingRow[3] || data.memberName || ''; // 멤버명 (구글 시트 우선)
          values[4] = data.industry || existingRow[4] || ''; // 산업군 - 앱에서 수정 가능 (Admin만 프론트엔드에서 수정 허용)
          values[5] = data.company || existingRow[5] || ''; // 회사 - 앱에서 수정 가능 (모든 사용자)
          // 양방향 연동 필드 (specialty, targetCustomer)는 앱에서 전달된 최신 데이터 사용
          // values[6] = specialty (G열) - 앱에서 업데이트된 값 사용
          // values[7] = targetCustomer (H열) - 앱에서 업데이트된 값 사용
          console.log(`🔄 Bidirectional field update for ${data.userEmail}:`, {
            specialty: { current: existingRow[6], updating: values[6] },
            targetCustomer: { current: existingRow[7], updating: values[7] }
          });
          
          // 파트너 정보는 앱에서 온 최신 데이터 사용 (index 8-19): 실시간 업데이트 보장
          console.log(`🔄 Partner info update for ${data.userEmail}:`, {
            rpartner1: { current: existingRow[8], updating: values[8] },
            rpartner1Specialty: { current: existingRow[9], updating: values[9] },
            rpartner1Stage: { current: existingRow[10], updating: values[10] },
            rpartner2: { current: existingRow[11], updating: values[11] },
            rpartner2Specialty: { current: existingRow[12], updating: values[12] },
            rpartner2Stage: { current: existingRow[13], updating: values[13] },
            rpartner3: { current: existingRow[14], updating: values[14] },
            rpartner3Specialty: { current: existingRow[15], updating: values[15] },
            rpartner3Stage: { current: existingRow[16], updating: values[16] },
            rpartner4: { current: existingRow[17], updating: values[17] },
            rpartner4Specialty: { current: existingRow[18], updating: values[18] },
            rpartner4Stage: { current: existingRow[19], updating: values[19] }
          });
          
          // 파트너 정보(values[8-19])는 이미 앱에서 전달된 최신 값으로 설정됨 - 기존 값으로 덮어쓰지 않음
          // 총 R파트너 수와 달성율(values[20-21])도 새로 계산된 값 사용
          
          // 🔥 CRITICAL FIX: 기존 사용자 업데이트 시에도 U/V열 재계산
          const updatedPartners = [
            { name: data.rpartner1, stage: data.rpartner1Stage },
            { name: data.rpartner2, stage: data.rpartner2Stage },
            { name: data.rpartner3, stage: data.rpartner3Stage },
            { name: data.rpartner4, stage: data.rpartner4Stage },
          ];
          
          const updatedProfitPartners = updatedPartners.filter(p => 
            p.name && p.name.trim() !== '' && p.stage?.includes('Profit')
          ).length;
          const updatedAchievement = Math.round((updatedProfitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
          
          console.log(`🔥 RECALCULATED U/V for existing user ${data.userEmail}:`, {
            partners: updatedPartners,
            profitPartners: updatedProfitPartners,
            achievement: updatedAchievement
          });
          
          // PW와 STATUS 값 유지 (X열, Y열, index 23, 24)
          let existingPW = existingRow[SHEET_COLUMN_INDICES.PASSWORD] ? existingRow[SHEET_COLUMN_INDICES.PASSWORD].toString().trim() : '';
          const existingStatus = existingRow[SHEET_COLUMN_INDICES.STATUS] ? existingRow[SHEET_COLUMN_INDICES.STATUS] : '활동중';
          
          // Joy 사용자의 경우 PW가 빈 값이면 기본 PW 설정
          if (!existingPW && data.userEmail === 'joy.byun@bnikorea.com') {
            existingPW = '1234'; // Joy 사용자 기본 PW
            console.log(`🔑 Setting default PW for Joy user: "${existingPW}"`);
          }
          
          // ✅ U/V열 항상 최신 계산값으로 업데이트 (IMPORTRANGE 호환성 보장)
          values[20] = updatedProfitPartners.toString(); // U열: 총 R파트너 수 - 문자열로
          values[21] = `${updatedAchievement}%`; // V열: 달성률
          
          console.log(`📊 U/V columns updated for ${data.userEmail}: U="${updatedProfitPartners}", V="${updatedAchievement}%"`);
          
          
          values[SHEET_COLUMN_INDICES.PASSWORD] = existingPW; // PW 필드 (X열)
          values[SHEET_COLUMN_INDICES.STATUS] = existingStatus; // STATUS 필드 (Y열)
          
          console.log(`🔐 PW field preserved: "${existingPW}" (length: ${existingPW.length})`);
          console.log(`🔍 Existing row data (length: ${existingRow.length}):`, existingRow.slice(20, 26));
        }
        
        const range = `RPS!A${userRowIndex + 1}:Y${userRowIndex + 1}`;
        console.log(`Updating existing user ${data.userEmail} in row ${userRowIndex + 1} with range ${range}`);
        console.log(`Values to update:`, values);
        
        // 🔥 CRITICAL DEBUG: 구글 시트 API 호출 전 상세 로그
        const requestBody = JSON.stringify({ values: [values] });
        console.log(`🔥 CRITICAL: About to update Google Sheets with:`, {
          url: `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
          range: range,
          method: 'PUT',
          specialtyValue: values[6], // G열 specialty
          bodyLength: requestBody.length,
          accessTokenStart: accessToken.substring(0, 20) + '...'
        });

        // Direct fetch call for update
        updateResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: requestBody
          }
        );

        // 🔥 CRITICAL DEBUG: 응답 상세 분석
        const responseClone = updateResponse.clone();
        const responseText = await responseClone.text();
        console.log(`🔥 CRITICAL: Google Sheets API Response:`, {
          status: updateResponse.status,
          ok: updateResponse.ok,
          headers: Object.fromEntries(updateResponse.headers.entries()),
          responseBody: responseText.substring(0, 500) + (responseText.length > 500 ? '...' : '')
        });

        // 🔥 IMMEDIATE VERIFICATION: 업데이트 직후 즉시 구글 시트에서 값 재확인
        console.log(`🔥 IMMEDIATE VERIFICATION: Checking if update actually persisted in Google Sheets...`);
        try {
          // Direct fetch call for verification
          const verifyResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!G${userRowIndex + 1}:G${userRowIndex + 1}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
          );
          
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            const actualValue = verifyData.values?.[0]?.[0] || 'EMPTY';
            console.log(`🔥 IMMEDIATE VERIFICATION RESULT:`, {
              expectedValue: values[6], // specialty field
              actualValueInSheets: actualValue,
              matches: values[6] === actualValue,
              rawVerifyData: verifyData
            });
            
            if (values[6] !== actualValue) {
              console.error(`🚨 CRITICAL FAILURE: Google Sheets update DID NOT PERSIST!`);
              console.error(`🚨 Expected: "${values[6]}", but found: "${actualValue}"`);
            } else {
              console.log(`✅ VERIFICATION SUCCESS: Google Sheets update successfully persisted!`);
            }
          } else {
            const errorText = await verifyResponse.text();
            console.error(`🔥 VERIFICATION API ERROR: Status ${verifyResponse.status}, Error: ${errorText}`);
          }
        } catch (verifyError) {
          console.error(`🔥 VERIFICATION ERROR:`, verifyError);
        }
      } else {
        // 새 사용자 추가: 빈 행 우선 사용, 없으면 마지막 행 다음에 추가
        let targetRow = -1;
        
        if (availableEmptyRows.length > 0) {
          // 빈 행 중 첫 번째 사용 (삭제된 사용자 자리 재활용)
          targetRow = availableEmptyRows[0] + 1; // 1-based index
          console.log(`♻️ Reusing empty row ${targetRow} for new user ${data.userEmail}`);
        } else {
          // 빈 행이 없으면 마지막 행 다음에 추가
          targetRow = existingRows.length + 1;
          console.log(`➕ Adding new user ${data.userEmail} at end of sheet (row ${targetRow})`);
        }
        
        // 행 범위 제한 (최대 5000행)
        if (targetRow > 5000) {
          console.error(`❌ Cannot add user ${data.userEmail}: Sheet limit reached (row ${targetRow})`);
          throw new Error('Google Sheets row limit reached. Please clean up deleted users.');
        }
        
        const range = `RPS!A${targetRow}:W${targetRow}`;
        console.log(`🆕 Adding new user ${data.userEmail} in row ${targetRow} with range ${range}`);
        
        // Direct fetch call for new user
        updateResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
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
          console.error('❌ Google Sheets sync error for', data.userEmail, ':', error);
          
          // 구체적인 에러 정보 로그
          console.error('Error details:', {
            message: error?.message,
            code: error?.code,
            status: error?.status,
            stack: error?.stack?.split('\n').slice(0, 3)
          });
          
          // 실제 Google Sheets API 에러인 경우 재시도 로직 없이 에러 던지기
          throw new Error(`Google Sheets 동기화 실패 - ${data.userEmail}: ${error?.message || 'Unknown error'}`);
        }
      },
      `user:${data.userEmail}` // lockKey for atomicity
    );
  }

  // 탈퇴 히스토리 기록
  async addWithdrawalHistory(userEmail: string, region: string, chapter: string, memberName: string): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      await this.ensureWithdrawalHistorySheet();

      // 1. RPS에서 전체 행 데이터(A~Z) 읽기
      const rpsResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      let fullRowData: string[] = [];
      if (rpsResp.ok) {
        const rpsData = await rpsResp.json();
        const rpsRows = rpsData.values || [];
        const headerRow = rpsRows[0] || [];
        const idColIdx = headerRow.findIndex((h: string) => h?.toString().trim().toUpperCase() === 'ID');
        if (idColIdx >= 0) {
          for (let i = 1; i < rpsRows.length; i++) {
            if (rpsRows[i][idColIdx]?.toString().trim().toLowerCase() === userEmail.toLowerCase()) {
              fullRowData = rpsRows[i].map((cell: any) => cell?.toString() || '');
              break;
            }
          }
        }
      }

      const withdrawalTime = new Date().toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });

      // 2. WithdrawalHistory 헤더 확인
      const headerResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A1:AA1`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (headerResp.ok) {
        const hd = await headerResp.json();
        if (!hd.values || hd.values.length === 0) {
          const rpsHeaderResp = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z1`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          let rpsHeader = ['이메일', '지역', '챕터', '멤버명'];
          if (rpsHeaderResp.ok) { const rhd = await rpsHeaderResp.json(); if (rhd.values?.[0]) rpsHeader = rhd.values[0]; }
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A1:AA1?valueInputOption=USER_ENTERED`,
            { method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [['탈퇴일시', ...rpsHeader]] }) }
          );
        }
      }

      // 3. 탈퇴일시 + 전체 행 데이터 저장
      const rowToAppend = fullRowData.length > 0
        ? [withdrawalTime, ...fullRowData]
        : [withdrawalTime, userEmail, region, chapter, memberName];

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A:AA:append?valueInputOption=USER_ENTERED`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [rowToAppend] }) }
      );

      console.log(`✅ 탈퇴 히스토리 기록 완료 (전체 데이터): ${userEmail} (${withdrawalTime})`);
      
    } catch (error) {
      console.error('탈퇴 히스토리 기록 중 오류:', error);
      throw error;
    }
  }

  // 탈퇴 히스토리 시트 존재 확인 및 생성
  private async ensureWithdrawalHistorySheet(): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      
      // 현재 시트 정보 가져오기
      const response = await requestQueue.enqueue(
        'ensureWithdrawalHistorySheet-read',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );
      
      if (!response.ok) {
        throw new Error(`시트 정보 조회 실패: ${response.status}`);
      }
      
      const spreadsheetData = await response.json();
      const sheets = spreadsheetData.sheets || [];
      
      // WithdrawalHistory 시트가 있는지 확인
      const historySheetExists = sheets.some((sheet: any) => 
        sheet.properties?.title === 'WithdrawalHistory'
      );
      
      if (!historySheetExists) {
        console.log('📋 탈퇴 히스토리 시트 생성 중...');
        
        // 새 시트 탭 생성
        const createSheetResponse = await requestQueue.enqueue(
          'ensureWithdrawalHistorySheet-create',
          async () => await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                requests: [{
                  addSheet: {
                    properties: {
                      title: 'WithdrawalHistory',
                      gridProperties: {
                        rowCount: 1000,
                        columnCount: 5
                      }
                    }
                  }
                }]
              })
            }
          )
        );
        
        if (!createSheetResponse.ok) {
          const errorText = await createSheetResponse.text();
          throw new Error(`시트 생성 실패: ${createSheetResponse.status} - ${errorText}`);
        }
        
        console.log('✅ WithdrawalHistory 시트 생성 완료');
      }
      
    } catch (error) {
      console.error('탈퇴 히스토리 시트 설정 중 오류:', error);
      throw error;
    }
  }

  // 탈퇴 히스토리 조회
  async getWithdrawalHistory(): Promise<Array<{
    withdrawalTime: string;
    email: string;
    region: string;
    chapter: string;
    memberName: string;
  }>> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        'getWithdrawalHistory',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A:E`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );
      
      if (!response.ok) {
        if (response.status === 400) {
          // WithdrawalHistory 시트가 없는 경우
          return [];
        }
        throw new Error(`탈퇴 히스토리 조회 실패: ${response.status}`);
      }
      
      const data = await response.json();
      const rows = data.values || [];
      
      if (rows.length <= 1) {
        return []; // 헤더만 있거나 데이터가 없는 경우
      }
      
      // 헤더 제외하고 데이터 변환
      return rows.slice(1).map((row: string[]) => ({
        withdrawalTime: row[0] || '',
        email: row[1] || '',
        region: row[2] || '',
        chapter: row[3] || '',
        memberName: row[4] || ''
      })).filter((item: { withdrawalTime: string; email: string; region: string; chapter: string; memberName: string }) => item.email); // 이메일이 있는 항목만 반환
      
    } catch (error) {
      console.error('탈퇴 히스토리 조회 중 오류:', error);
      return [];
    }
  }

  // 탈퇴용 사용자 정보 조회
  private async getUserForWithdrawalHistory(userEmail: string): Promise<{
    email: string;
    region: string;
    chapter: string;
    memberName: string;
  } | null> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        `getUserForWithdrawalHistory-${userEmail}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!response.ok) {
        throw new Error(`Failed to read Google Sheets: ${response.status}`);
      }

      const data = await response.json();
      const rows = data.values || [];
      
      // 사용자 행 검색
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i][0] && 
            rows[i][0].toString().trim().toLowerCase() === userEmail.toLowerCase()) {
          return {
            email: rows[i][0] || '',
            region: rows[i][1] || '',
            chapter: rows[i][2] || '',
            memberName: rows[i][3] || ''
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('사용자 정보 조회 중 오류:', error);
      return null;
    }
  }

  // 사용자 완전 삭제 - 구글 시트에서 해당 행 자체를 삭제
  async markUserAsWithdrawn(userEmail: string): Promise<void> {
    return requestQueue.enqueue(
      `markUserAsWithdrawn-${userEmail}`,
      async () => {
        try {
          const accessToken = await this.getAccessToken();
          
          // 사용자 행 찾기 - direct fetch call (히스토리용 정보도 여기서 추출)
          const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (!getResponse.ok) {
            throw new Error(`Failed to read Google Sheets: ${getResponse.status}`);
          }

          const data = await getResponse.json();
          const rows = data.values || [];
          
          // 사용자 행 검색 및 정보 추출 (히스토리용)
          let userRowIndex = -1;
          let userInfo: { email: string; region: string; chapter: string; memberName: string } | null = null;
          
          for (let i = 1; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && 
                rows[i][0].toString().trim().toLowerCase() === userEmail.toLowerCase()) {
              userRowIndex = i;
              userInfo = {
                email: rows[i][0] || '',
                region: rows[i][1] || '',
                chapter: rows[i][2] || '',
                memberName: rows[i][3] || ''
              };
              break;
            }
          }
          
          if (userRowIndex === -1) {
            throw new Error(`User ${userEmail} not found in Google Sheets`);
          }
          
          console.log(`🗑️ Deleting user ${userEmail} from row ${userRowIndex + 1} (완전 삭제)`);
          
          // 구글 시트 API를 사용하여 행 완전 삭제 - direct fetch call
          const deleteResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                requests: [{
                  deleteDimension: {
                    range: {
                      sheetId: 0, // RPS 시트 ID (대부분 0)
                      dimension: 'ROWS',
                      startIndex: userRowIndex, // 0-based index
                      endIndex: userRowIndex + 1 // exclusive
                    }
                  }
                }]
              })
            }
          );

          if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to delete user row: ${deleteResponse.status} ${errorText}`);
          }

          console.log(`✅ User ${userEmail} completely deleted from Google Sheets (행 삭제 완료)`);
          
          // 탈퇴 히스토리 기록 - 직접 fetch로 처리 (중첩 enqueue 방지)
          if (userInfo) {
            try {
              const withdrawalTime = new Date().toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });
              
              // 직접 append API 호출
              const historyResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A:E:append?valueInputOption=USER_ENTERED`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    values: [[withdrawalTime, userInfo.email, userInfo.region, userInfo.chapter, userInfo.memberName]]
                  })
                }
              );
              
              if (historyResponse.ok) {
                console.log(`✅ 탈퇴 히스토리 기록 완료: ${userEmail} (${withdrawalTime})`);
              } else {
                console.error('⚠️ 탈퇴 히스토리 기록 실패 (삭제는 완료됨)');
              }
            } catch (historyError) {
              console.error('⚠️ 탈퇴 히스토리 기록 실패 (삭제는 완료됨):', historyError);
              // 히스토리 기록 실패해도 삭제는 완료되었으므로 계속 진행
            }
          }
          
        } catch (error: any) {
          console.error(`❌ Error deleting user ${userEmail}:`, error);
          throw new Error(`사용자 삭제 실패: ${error?.message || 'Unknown error'}`);
        }
      },
      `user:${userEmail}` // lockKey for atomicity
    );
  }

  // 일괄 사용자 삭제 - 여러 사용자를 한 번에 삭제 (최적화)
  async bulkMarkUsersAsWithdrawn(userEmails: string[]): Promise<{ processedCount: number; errors: string[] }> {
    return requestQueue.enqueue(
      `bulkMarkUsersAsWithdrawn`,
      async () => {
        const errors: string[] = [];
        let processedCount = 0;
        
        try {
          const accessToken = await this.getAccessToken();
          
          // 1. 시트 데이터 한 번만 읽기
          const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (!getResponse.ok) {
            throw new Error(`Failed to read Google Sheets: ${getResponse.status}`);
          }

          const data = await getResponse.json();
          const rows = data.values || [];
          
          // 2. 삭제할 사용자들의 행 인덱스와 정보 수집
          const usersToDelete: { rowIndex: number; email: string; region: string; chapter: string; memberName: string }[] = [];
          
          for (const email of userEmails) {
            const normalizedEmail = email.trim().toLowerCase();
            let found = false;
            
            for (let i = 1; i < rows.length; i++) {
              if (rows[i] && rows[i][0] && 
                  rows[i][0].toString().trim().toLowerCase() === normalizedEmail) {
                usersToDelete.push({
                  rowIndex: i,
                  email: rows[i][0] || '',
                  region: rows[i][1] || '',
                  chapter: rows[i][2] || '',
                  memberName: rows[i][3] || ''
                });
                found = true;
                break;
              }
            }
            
            if (!found) {
              errors.push(`${email}: 사용자를 찾을 수 없습니다`);
            }
          }
          
          if (usersToDelete.length === 0) {
            console.log('⚠️ 삭제할 사용자가 없습니다');
            return { processedCount: 0, errors };
          }
          
          // 3. 행 인덱스를 내림차순으로 정렬 (뒤에서부터 삭제해야 인덱스가 밀리지 않음)
          usersToDelete.sort((a, b) => b.rowIndex - a.rowIndex);
          
          console.log(`🗑️ Bulk deleting ${usersToDelete.length} users: ${usersToDelete.map(u => u.email).join(', ')}`);
          
          // 4. batchUpdate로 여러 행 한 번에 삭제
          const deleteRequests = usersToDelete.map(user => ({
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex: user.rowIndex,
                endIndex: user.rowIndex + 1
              }
            }
          }));
          
          const deleteResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ requests: deleteRequests })
            }
          );

          if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to bulk delete users: ${deleteResponse.status} ${errorText}`);
          }
          
          processedCount = usersToDelete.length;
          console.log(`✅ Bulk deleted ${processedCount} users from Google Sheets`);
          
          // 5. 탈퇴 히스토리 일괄 기록
          const withdrawalTime = new Date().toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          
          const historyRows = usersToDelete.map(user => [
            withdrawalTime,
            user.email,
            user.region,
            user.chapter,
            user.memberName
          ]);
          
          try {
            const historyResponse = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A:E:append?valueInputOption=USER_ENTERED`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: historyRows })
              }
            );
            
            if (historyResponse.ok) {
              console.log(`✅ 탈퇴 히스토리 일괄 기록 완료: ${processedCount}명`);
            } else {
              console.error('⚠️ 탈퇴 히스토리 기록 실패 (삭제는 완료됨)');
            }
          } catch (historyError) {
            console.error('⚠️ 탈퇴 히스토리 기록 실패 (삭제는 완료됨):', historyError);
          }
          
          return { processedCount, errors };
          
        } catch (error: any) {
          console.error(`❌ Bulk withdrawal error:`, error);
          throw new Error(`일괄 삭제 실패: ${error?.message || 'Unknown error'}`);
        }
      },
      'bulk-withdrawal' // lockKey
    );
  }

  // 사용자 상태 업데이트 (복원용)
  async updateUserStatus(userEmail: string, newStatus: string): Promise<void> {
    return requestQueue.enqueue(
      `updateUserStatus-${userEmail}`,
      async () => {
        try {
          const accessToken = await this.getAccessToken();
          
          // 사용자 행 찾기 - direct fetch call
          const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:X5000`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (!getResponse.ok) {
            throw new Error(`Failed to read Google Sheets: ${getResponse.status}`);
          }

          const data = await getResponse.json();
          const rows = data.values || [];
          
          // 사용자 행 검색
          let userRowIndex = -1;
          for (let i = 1; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && 
                rows[i][0].toString().trim().toLowerCase() === userEmail.toLowerCase()) {
              userRowIndex = i;
              break;
            }
          }
          
          if (userRowIndex === -1) {
            throw new Error(`User ${userEmail} not found in Google Sheets`);
          }
          
          // STATUS 컬럼 업데이트 (Y열, 인덱스 24)
          const range = `RPS!Y${userRowIndex + 1}`;
          console.log(`🔄 Updating user ${userEmail} status to "${newStatus}" in row ${userRowIndex + 1}`);
          
          // Direct fetch call for update
          const updateResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                values: [[newStatus]]
              })
            }
          );

          if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            throw new Error(`Failed to update user status: ${updateResponse.status} ${errorText}`);
          }

          console.log(`✅ User ${userEmail} status updated to "${newStatus}"`);
        } catch (error: any) {
          console.error(`❌ Error updating user ${userEmail} status:`, error);
          throw new Error(`상태 업데이트 실패: ${error?.message || 'Unknown error'}`);
        }
      },
      `user:${userEmail}` // lockKey for atomicity
    );
  }

  // 관리자용: 사용자 정보 업데이트 (지역, 챕터, 멤버명, 산업군, 회사, 비밀번호)
  async updateUserInfo(userEmail: string, updates: {
    region?: string;
    chapter?: string;
    memberName?: string;
    industry?: string;
    company?: string;
    password?: string;
  }): Promise<{ success: boolean; message?: string }> {
    return requestQueue.enqueue(
      `updateUserInfo-${userEmail}`,
      async () => {
        try {
          const accessToken = await this.getAccessToken();
          
          // 사용자 행 찾기
          const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (!getResponse.ok) {
            throw new Error(`Failed to read Google Sheets: ${getResponse.status}`);
          }

          const data = await getResponse.json();
          const rows = data.values || [];
          const headers = rows[0] || [];
          
          // 사용자 행 검색
          let userRowIndex = -1;
          for (let i = 1; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && 
                rows[i][0].toString().trim().toLowerCase() === userEmail.toLowerCase()) {
              userRowIndex = i;
              break;
            }
          }
          
          if (userRowIndex === -1) {
            return { success: false, message: `사용자 ${userEmail}을(를) 찾을 수 없습니다` };
          }

          // 컬럼 인덱스 찾기
          const columnMap: Record<string, number> = {};
          headers.forEach((header: string, index: number) => {
            const h = header?.toString().toLowerCase().trim();
            if (h === 'id' || h === '이메일' || h === 'email') columnMap['email'] = index;
            if (h === 'region' || h === '지역' || h === '지역명') columnMap['region'] = index;
            if (h === 'chapter' || h === '챕터' || h === '챕터명') columnMap['chapter'] = index;
            if (h === 'member' || h === 'member name' || h === '담당자명') columnMap['memberName'] = index;
            if (h === 'industry' || h === '산업군' || h === '업종') columnMap['industry'] = index;
            if (h === 'company' || h === '회사' || h === '회사명') columnMap['company'] = index;
            if (h === 'pw' || h === '비밀번호' || h === 'password') columnMap['password'] = index;
          });

          // 업데이트할 데이터 준비
          const requests: any[] = [];
          const rowNumber = userRowIndex + 1;
          
          const fieldToColumn: Record<string, string> = {
            region: 'B',
            chapter: 'C', 
            memberName: 'D',
            industry: 'E',
            company: 'F',
            password: 'X'
          };

          Object.entries(updates).forEach(([field, value]) => {
            if (value !== undefined && value !== '' && fieldToColumn[field]) {
              const columnLetter = fieldToColumn[field];
              requests.push({
                range: `RPS!${columnLetter}${rowNumber}`,
                values: [[value]]
              });
            }
          });

          if (requests.length === 0) {
            return { success: true, message: '업데이트할 정보가 없습니다' };
          }

          console.log(`🔄 Updating user ${userEmail} info with ${requests.length} fields`);

          // batchUpdate 사용하여 여러 필드 한번에 업데이트
          const batchUpdateResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchUpdate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                valueInputOption: 'USER_ENTERED',
                data: requests
              })
            }
          );

          if (!batchUpdateResponse.ok) {
            const error = await batchUpdateResponse.text();
            throw new Error(`Failed to update: ${error}`);
          }

          console.log(`✅ User ${userEmail} info updated successfully`);
          return { success: true, message: '정보가 성공적으로 수정되었습니다' };
        } catch (error: any) {
          console.error(`❌ Error updating user ${userEmail} info:`, error);
          return { success: false, message: `수정 실패: ${error?.message || 'Unknown error'}` };
        }
      },
      `user:${userEmail}` // lockKey for atomicity
    );
  }

  // 관리자용: 모든 사용자 데이터 가져오기
  async findUserByEmail(email: string): Promise<any[] | null> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        `findUserByEmail-${email}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!response.ok) {
        throw new Error('Failed to read Google Sheets for user search');
      }

      const data = await response.json();
      const rows = data.values || [];
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[0] && row[0].toString().trim().toLowerCase() === email.toLowerCase()) {
          return row;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding user by email:', error);
      return null;
    }
  }

  async getAllUsers(): Promise<any[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      // 캐시 방지를 위한 타임스탬프 추가
      const timestamp = Date.now();
      const getResponse = await requestQueue.enqueue(
        `getAllUsers-${timestamp}`,
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000?t=${timestamp}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            }
          }
        )
      );

      if (!getResponse.ok) {
        throw new Error(`Failed to read Google Sheets: ${getResponse.status}`);
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      if (rows.length <= 1) return []; // 헤더만 있거나 빈 시트
      
      const users: any[] = [];
      
      // 헤더 행 스킵하고 데이터 행들 처리
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // 빈 행이나 이메일이 없는 행은 스킵
        if (!row || !row[0] || !row[0].toString().trim()) {
          continue;
        }
        
        const status = row[SHEET_COLUMN_INDICES.STATUS] || '활동중'; // STATUS 컬럼
        
        const userData = {
          email: row[0] || '',
          region: row[1] || '',
          chapter: row[2] || '',
          memberName: row[3] || '',
          industry: row[4] || '', // 산업군 추가 (index 4)
          company: row[5] || '', // 회사 추가 (index 5)
          specialty: row[6] || '', // 전문분야 (index 6)
          targetCustomer: row[7] || '', // 나의 핵심 고객층 (index 7)
          rpartner1: row[8] || '', // R파트너 1 (index 8)
          rpartner1Specialty: row[9] || '', // R파트너 1 전문분야 (index 9)
          rpartner1Stage: this.normalizeStage(row[10] || ''), // R파트너 1 V-C-P (index 10)
          rpartner2: row[11] || '', // R파트너 2 (index 11)
          rpartner2Specialty: row[12] || '', // R파트너 2 전문분야 (index 12)
          rpartner2Stage: this.normalizeStage(row[13] || ''), // R파트너 2 V-C-P (index 13)
          rpartner3: row[14] || '', // R파트너 3 (index 14)
          rpartner3Specialty: row[15] || '', // R파트너 3 전문분야 (index 15)
          rpartner3Stage: this.normalizeStage(row[16] || ''), // R파트너 3 V-C-P (index 16)
          rpartner4: row[17] || '', // R파트너 4 (index 17)
          rpartner4Specialty: row[18] || '', // R파트너 4 전문분야 (index 18)
          rpartner4Stage: this.normalizeStage(row[19] || ''), // R파트너 4 V-C-P (index 19)
          totalPartners: row[20] || '0', // 총 R파트너 수 (index 20)
          achievement: row[21] || '0%', // 달성 (index 21)
          status: status
        };
        
        users.push(userData);
      }
      
      console.log(`📊 Retrieved ${users.length} users from Google Sheets for admin panel`);
      return users;
      
    } catch (error) {
      console.error('❌ Error fetching all users from Google Sheets:', error);
      throw new Error(`모든 사용자 조회 실패: ${error}`);
    }
  }
  
  // 동적 사용자 관리: Google Sheets의 활성 사용자 목록 가져오기
  async getActiveUsersFromGoogleSheets(): Promise<string[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      // 요청 큐를 통해 처리하여 동시 접속 문제 해결
      const getResponse = await requestQueue.enqueue(
        'getActiveUsers',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:A5000`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!getResponse.ok) {
        console.error('Failed to read Google Sheets for active users');
        return [];
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 헤더 제외하고 실제 이메일만 추출
      const activeEmails = rows.slice(1)
        .filter((row: any) => row && row[0] && row[0].toString().trim())
        .map((row: any) => row[0].toString().trim().toLowerCase());
      
      console.log(`🔍 Active users in Google Sheets: ${activeEmails.length} (max 5000 supported)`);
      return activeEmails;
    } catch (error) {
      console.error('❌ Error getting active users from Google Sheets:', error);
      return [];
    }
  }
  
  // Master 탭에서 지역 목록 가져오기
  async getRegionsFromMaster(): Promise<string[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        'getRegionsFromMaster',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Master!A2:A100`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!response.ok) {
        console.error('Failed to read Master sheet for regions');
        return [];
      }

      const data = await response.json();
      const rows = data.values || [];
      
      const regions = rows
        .filter((row: any) => row && row[0] && row[0].toString().trim())
        .map((row: any) => row[0].toString().trim());
      
      console.log(`📋 Regions from Master sheet: ${regions.length} items`);
      return regions;
    } catch (error) {
      console.error('❌ Error getting regions from Master sheet:', error);
      return [];
    }
  }

  // Master 탭에서 챕터 목록 가져오기
  async getChaptersFromMaster(): Promise<string[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        'getChaptersFromMaster',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Master!B2:B200`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );

      if (!response.ok) {
        console.error('Failed to read Master sheet for chapters');
        return [];
      }

      const data = await response.json();
      const rows = data.values || [];
      
      const chapters = rows
        .filter((row: any) => row && row[0] && row[0].toString().trim())
        .map((row: any) => row[0].toString().trim());
      
      console.log(`📋 Chapters from Master sheet: ${chapters.length} items`);
      return chapters;
    } catch (error) {
      console.error('❌ Error getting chapters from Master sheet:', error);
      return [];
    }
  }

  // Master 탭 생성
  private async createMasterSheet(): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await requestQueue.enqueue(
        'createMasterSheet',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              requests: [{
                addSheet: {
                  properties: {
                    title: 'Master'
                  }
                }
              }]
            })
          }
        )
      );

      if (!response.ok) {
        const errorText = await response.text();
        // 이미 존재하는 경우 성공으로 처리
        if (errorText.includes('already exists')) {
          console.log('Master sheet already exists');
          return true;
        }
        console.error('Failed to create Master sheet:', errorText);
        return false;
      }

      console.log('✅ Master sheet created successfully');
      return true;
    } catch (error) {
      console.error('❌ Error creating Master sheet:', error);
      return false;
    }
  }

  // Master 탭 초기화 (지역/챕터 데이터 생성)
  async initializeMasterSheet(regions: string[], chapters: string[]): Promise<boolean> {
    try {
      // 먼저 Master 탭이 있는지 확인하고 없으면 생성
      await this.createMasterSheet();
      
      const accessToken = await this.getAccessToken();
      
      // 헤더 + 데이터 구성
      const maxRows = Math.max(regions.length, chapters.length);
      const values: string[][] = [['지역', '챕터']];
      
      for (let i = 0; i < maxRows; i++) {
        values.push([
          regions[i] || '',
          chapters[i] || ''
        ]);
      }
      
      const response = await requestQueue.enqueue(
        'initializeMasterSheet',
        async () => await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Master!A1:B${maxRows + 1}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
          }
        )
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to initialize Master sheet:', errorText);
        return false;
      }

      console.log(`✅ Master sheet initialized with ${regions.length} regions and ${chapters.length} chapters`);
      return true;
    } catch (error) {
      console.error('❌ Error initializing Master sheet:', error);
      return false;
    }
  }

  private logSyncData(data: ScoreboardData & { userEmail: string }): void {
    console.log('\n📊 GOOGLE SHEETS SYNC DATA (for manual entry if needed):');
    console.log('='.repeat(60));
    console.log(`User: ${data.userEmail}`);
    console.log(`Region: ${data.region || 'N/A'}`);
    console.log(`Chapter: ${data.partner || 'N/A'}`);
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
    
    const profitPartners = partners.filter(p => p.stage?.includes('Profit')).length;
    const achievement = Math.round((profitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
    
    console.log(`Total R-Partners: ${partners.filter(p => p.name).length}`);
    console.log(`Achievement: ${achievement}%`);
    console.log('='.repeat(60));
  }

  async logActivity(email: string, action: string, details: string = ''): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())},${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

      const sheetName = 'ActivityLog';
      const row = [timestamp, email, action, details];

      // Ensure ActivityLog sheet exists by trying to read it first
      const checkResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?access_token=${accessToken}`
      );

      if (!checkResp.ok) {
        // Create the sheet tab
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: sheetName } } }]
            })
          }
        );
        // Add header row
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:D1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Timestamp', 'Email', 'Action', 'Details']] })
          }
        );
      }

      // Append row
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        }
      );
      console.log(`📝 Activity logged: ${action} by ${email}`);
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  async addChapterToMaster(chapter: string, region: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Master!A:B:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[region, chapter]] })
      }
    );
    console.log(`📝 New chapter added to Master: ${chapter} (${region})`);
  }

  async getAdminList(): Promise<{ region: string; memberName: string; email: string; auth: string }[]> {
    const accessToken = await this.getAccessToken();
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Admin!A2:E200`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.values || [])
      .filter((row: any[]) => row[2]?.toString().trim())
      .map((row: any[]) => ({
        region: row[0]?.toString().trim() || '',
        memberName: row[1]?.toString().trim() || '',
        email: row[2]?.toString().trim() || '',
        auth: row[4]?.toString().trim() || 'Admin',
      }));
  }

  async deleteAdminFromSheet(email: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Admin!A2:E200`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!resp.ok) throw new Error('Admin 시트를 읽을 수 없습니다');
    const data = await resp.json();
    const rows = data.values || [];
    const rowIndex = rows.findIndex((row: any[]) => row[2]?.toString().trim().toLowerCase() === email.toLowerCase());
    if (rowIndex === -1) throw new Error(`'${email}' 관리자를 찾을 수 없습니다`);

    const sheetRowNumber = rowIndex + 2;
    const metaResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const meta = await metaResp.json();
    const adminSheet = meta.sheets?.find((s: any) => s.properties.title === 'Admin');
    if (!adminSheet) throw new Error('Admin 시트를 찾을 수 없습니다');

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId: adminSheet.properties.sheetId, dimension: 'ROWS', startIndex: sheetRowNumber - 1, endIndex: sheetRowNumber }
            }
          }]
        })
      }
    );
    console.log(`🗑️ Admin deleted: ${email}`);
  }

  async deleteChapterFromMaster(chapter: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/Master!A2:B200`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!resp.ok) throw new Error('Master 시트를 읽을 수 없습니다');
    const data = await resp.json();
    const rows = data.values || [];

    const rowIndex = rows.findIndex((row: any[]) => row[1]?.toString().trim() === chapter);
    if (rowIndex === -1) throw new Error(`'${chapter}' 챕터를 찾을 수 없습니다`);

    const sheetRowNumber = rowIndex + 2; // header row offset

    // Get Master sheet ID
    const metaResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const meta = await metaResp.json();
    const masterSheet = meta.sheets?.find((s: any) => s.properties.title === 'Master');
    if (!masterSheet) throw new Error('Master 시트를 찾을 수 없습니다');
    const sheetId = masterSheet.properties.sheetId;

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: sheetRowNumber - 1, endIndex: sheetRowNumber }
            }
          }]
        })
      }
    );
    console.log(`🗑️ Chapter deleted from Master: ${chapter}`);
  }

  async logChapterActivity(adminEmail: string, action: string, details: string = ''): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())},${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

      const sheetName = 'ChapterLog';
      const row = [timestamp, adminEmail, action, details];

      const checkResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?access_token=${accessToken}`
      );
      if (!checkResp.ok) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
          }
        );
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:D1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Timestamp', 'Admin Email', 'Action', 'Details']] })
          }
        );
      }

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        }
      );
      console.log(`📝 Chapter activity logged: ${action} by ${adminEmail}`);
    } catch (error) {
      console.error('Failed to log chapter activity:', error);
    }
  }

  async logAdminActivity(adminEmail: string, action: string, details: string = ''): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())},${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

      const sheetName = 'AdminLog';
      const row = [timestamp, adminEmail, action, details];

      const checkResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?access_token=${accessToken}`
      );
      if (!checkResp.ok) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
          }
        );
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:D1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Timestamp', 'Admin Email', 'Action', 'Details']] })
          }
        );
      }

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        }
      );
      console.log(`📝 Admin activity logged: ${action} by ${adminEmail}`);
    } catch (error) {
      console.error('Failed to log admin activity:', error);
    }
  }

  async restoreMemberFromHistory(email: string, region: string, chapter: string, memberName: string): Promise<void> {
    const accessToken = await this.getAccessToken();

    // 1. WithdrawalHistory 헤더 + 전체 행 데이터 읽기
    const histResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/WithdrawalHistory!A1:AA5000`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!histResp.ok) throw new Error('WithdrawalHistory 시트를 읽을 수 없습니다');
    const histData = await histResp.json();
    const allRows = histData.values || [];
    if (allRows.length < 2) throw new Error('WithdrawalHistory에 데이터가 없습니다');

    const headerRow = allRows[0];
    const histRows = allRows.slice(1);

    // 헤더에서 ID 열 찾기
    let idColIdx = -1;
    for (let j = 0; j < headerRow.length; j++) {
      const h = headerRow[j]?.toString().trim().toUpperCase() || '';
      if (h === 'ID' || h === '이메일') { idColIdx = j; break; }
    }
    let histRowIndex = -1;
    for (let i = histRows.length - 1; i >= 0; i--) {
      if (idColIdx >= 0) {
        if (histRows[i][idColIdx]?.toString().trim().toLowerCase() === email.toLowerCase()) { histRowIndex = i; break; }
      } else {
        if (histRows[i].some((cell: any) => cell?.toString().trim().toLowerCase() === email.toLowerCase())) { histRowIndex = i; break; }
      }
    }
    if (histRowIndex === -1) throw new Error(`WithdrawalHistory에서 '${email}'을 찾을 수 없습니다`);

    const fullRow = histRows[histRowIndex];
    const rpsRowData = fullRow.slice(1);

    // 2. RPS에 복원
    const rpsResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:Z5000`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    let alreadyExists = false;
    if (rpsResp.ok) {
      const rpsData = await rpsResp.json();
      const rpsRows = rpsData.values || [];
      const rpsHeader = rpsRows[0] || [];
      const rpsIdCol = rpsHeader.findIndex((h: string) => h?.toString().trim().toUpperCase() === 'ID');
      if (rpsIdCol >= 0) {
        alreadyExists = rpsRows.some((row: any[], i: number) => i > 0 && row[rpsIdCol]?.toString().trim().toLowerCase() === email.toLowerCase());
      }
    }
    if (!alreadyExists) {
      if (rpsRowData.length >= 10) {
        const rpsDataResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:A5000`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        let targetRow = 2;
        if (rpsDataResp.ok) {
          const rpsD = await rpsDataResp.json();
          const col = rpsD.values || [];
          for (let i = col.length - 1; i >= 1; i--) { if (col[i] && col[i][0]?.toString().trim()) { targetRow = i + 2; break; } }
        }
        const range = `RPS!A${targetRow}:Z${targetRow}`;
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
          method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [rpsRowData] })
        });
      } else {
        try {
          await this.addNewUser({ email, region: region || '', chapter: chapter || '', memberName: memberName || '', industry: '', company: '', specialty: '', targetCustomer: '', password: '0000', auth: 'Member' });
        } catch (e: any) { if (!e.message?.includes('already exists')) throw e; }
      }
    } else {
      console.log(`ℹ️ ${email} already in RPS, skipping add`);
    }

    // 3. WithdrawalHistory에서 삭제
    const sheetRowNumber = histRowIndex + 2;
    const metaResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const meta = await metaResp.json();
    const histSheet = meta.sheets?.find((s: any) => s.properties.title === 'WithdrawalHistory');
    if (!histSheet) throw new Error('WithdrawalHistory 시트를 찾을 수 없습니다');
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: histSheet.properties.sheetId, dimension: 'ROWS', startIndex: sheetRowNumber - 1, endIndex: sheetRowNumber } } }] })
    });
    console.log(`✅ Member restored with full data: ${memberName} (${email})`);
  }

  async deleteBoardPost(rowIndex: number): Promise<void> {
    const accessToken = await this.getAccessToken();
    const metaResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const meta = await metaResp.json();
    const sheet = meta.sheets?.find((s: any) => s.properties.title === 'BoardLog');
    if (!sheet) throw new Error('BoardLog 시트를 찾을 수 없습니다');
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex } } }] })
    });
  }

  async updateBoardPost(rowIndex: number, content: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/BoardLog!F${rowIndex}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[content]] })
      }
    );
  }

  async getMasterNotices(): Promise<any[]> {
    try {
      const accessToken = await this.getAccessToken();
      const sheetName = 'MasterLog';
      const checkResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?access_token=${accessToken}`
      );
      if (!checkResp.ok) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
        });
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:B1?valueInputOption=RAW`, {
          method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Timestamp', 'Content']] })
        });
        return [];
      }
      const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2:B100`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.values || [])
        .filter((row: any[]) => row[1]?.toString().trim())
        .map((row: any[]) => ({
          timestamp: row[0]?.toString().trim() || '',
          content: row[1]?.toString().trim() || '',
        }));
    } catch (error) {
      console.error('Failed to get master notices:', error);
      return [];
    }
  }

  async getBoardPosts(): Promise<any[]> {
    try {
      const accessToken = await this.getAccessToken();
      const sheetName = 'BoardLog';
      const checkResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?access_token=${accessToken}`
      );
      if (!checkResp.ok) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
          }
        );
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:G1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Timestamp', 'Email', 'Name', 'Role', 'Type', 'Content', 'ParentIndex']] })
          }
        );
        return [];
      }
      const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2:G500`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.values || []).map((row: any[], i: number) => ({
        index: i + 2,
        timestamp: row[0] || '',
        email: row[1] || '',
        name: row[2] || '',
        role: row[3] || '',
        type: row[4] || '',
        content: row[5] || '',
        parentIndex: row[6] || '',
      }));
    } catch (error) {
      console.error('Failed to get board posts:', error);
      return [];
    }
  }

  async addBoardPost(email: string, name: string, role: string, type: string, content: string, parentIndex: string = ''): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())},${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent('BoardLog')}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[timestamp, email, name, role, type, content, parentIndex]] })
        }
      );
    } catch (error) {
      console.error('Failed to add board post:', error);
    }
  }

  async readSheetRange(sheetName: string, range: string): Promise<any[][]> {
    const accessToken = await this.getAccessToken();
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(sheetName)}!${range}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return d.values || [];
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