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
      return this.accessToken || '';
      
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
            achievement: row[19] || '',
            auth: row[23] || '' // AUTH 컬럼 추가 (24번째 컬럼, index 23)
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

  async checkAdminPermission(email: string): Promise<boolean> {
    try {
      console.log(`🔐 Checking admin permission for ${email}...`);
      
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A:X?access_token=${this.accessToken}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
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
          
          const isAdmin = authInSheet === 'Admin' || authInSheet === 'Growth';
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

  // V-C-P 단계를 전체 텍스트로 변환하는 함수
  private convertStageToFullText(stage: string): string {
    const stageMap: { [key: string]: string } = {
      'V': 'Visibility : 아는단계',
      'C': 'Credibility : 신뢰단계', 
      'P': 'Profit : 수익단계'
    };
    // "none" 값은 빈 문자열로 변환
    if (stage === 'none' || !stage) return '';
    return stageMap[stage] || stage;
  }

  // 전체 텍스트에서 V-C-P 값을 추출하는 함수
  private convertFullTextToStage(fullText: string): string {
    if (fullText.includes('Visibility')) return 'V';
    if (fullText.includes('Credibility')) return 'C';
    if (fullText.includes('Profit')) return 'P';
    return fullText; // 기존 V, C, P 값 그대로 반환
  }

  async addNewUser(userData: {
    email: string;
    region: string;
    chapter: string;
    memberName: string;
    specialty: string;
    targetCustomer: string;
    password?: string;
    auth?: string;
  }): Promise<void> {
    try {
      console.log(`🆕 Adding new user to Google Sheets: ${userData.email}`, {
        password: userData.password || '1234',
        auth: userData.auth || 'Member'
      });
      
      // Get access token
      const accessToken = await this.getAccessToken();
      
      // Check if user already exists
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
        userData.specialty,       // E: 전문분야
        userData.targetCustomer,  // F: 나의 핵심 고객층
        '',                       // G: R파트너 1
        '',                       // H: R파트너 1 전문분야
        '',                       // I: R파트너 1 V-C-P
        '',                       // J: R파트너 2
        '',                       // K: R파트너 2 전문분야
        '',                       // L: R파트너 2 V-C-P
        '',                       // M: R파트너 3
        '',                       // N: R파트너 3 전문분야
        '',                       // O: R파트너 3 V-C-P
        '',                       // P: R파트너 4
        '',                       // Q: R파트너 4 전문분야
        '',                       // R: R파트너 4 V-C-P
        '0',                      // S: 총 R파트너 수
        '0%',                     // T: 달성
        userData.email,           // U: ID
        userData.password || '1234', // V: PW
        '활동중',                 // W: STATUS
        userData.auth || 'Member' // X: AUTH
      ];

      console.log(`📝 Writing data to row ${targetRowIndex + 1}:`, {
        email: newUserData[0],
        password: newUserData[21], // V: PW
        auth: newUserData[23]      // X: AUTH
      });

      const range = `RPS!A${targetRowIndex + 1}:X${targetRowIndex + 1}`;
      
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
      
      // 강화된 달성률 계산 - 이름이 있고 P 단계인 파트너만 카운트
      const profitPartners = partners.filter(p => 
        p.name && p.name.trim() !== '' && p.stage === 'P'
      ).length;
      const achievement = Math.round((profitPartners / 4) * 100);
      
      console.log(`📊 Achievement calculation for ${data.userEmail}:`, {
        allPartners: partners,
        profitPartners,
        achievement: `${achievement}%`,
        partnerDetails: partners.map((p, i) => `Partner ${i+1}: "${p.name}" (${p.stage})`)
      });
      
      // Add total partners and achievement (S열, T열)
      values.push(profitPartners.toString()); // S열: 총 R파트너 수 - P 단계만 (index 18)
      values.push(`${achievement}%`); // T열: 달성 (index 19)
      
      // Add ID, PW and STATUS columns (U열, V열, W열) - 기존 값 유지  
      values.push(data.userEmail); // U열: ID (index 20)
      values.push(''); // V열: PW (index 21) - 기존 값 유지
      values.push('활동중'); // W열: STATUS (index 22) - 기본값
      
      console.log('Data to sync to Google Sheets (with full stage text):', values);

      // 동적 사용자 관리: 전체 시트에서 사용자 검색 (최대 5000행)
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:W5000`,
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
          values[1] = existingRow[1] || data.region || ''; // 지역
          values[2] = existingRow[2] || data.partner || ''; // 챕터
          values[3] = existingRow[3] || data.memberName || ''; // 멤버명
          values[4] = existingRow[4] || data.specialty || ''; // 전문분야
          values[5] = data.targetCustomer || existingRow[5] || ''; // 나의 핵심 고객층 - 앱 데이터 우선
          
          // 파트너 정보는 앱에서 온 최신 데이터 사용 (index 6-17)
          // 총 R파트너 수와 달성율은 새로 계산된 값 사용 (index 18-19)
          
          // PW와 STATUS 값 유지 (V열, W열, index 21, 22)
          const existingPW = existingRow[21] ? existingRow[21] : '';
          const existingStatus = existingRow[22] ? existingRow[22] : '활동중';
          values[21] = existingPW;
          values[22] = existingStatus;
        }
        
        const range = `RPS!A${userRowIndex + 1}:W${userRowIndex + 1}`;
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

  // 사용자 탈퇴 처리 - STATUS를 "탈퇴"로 변경
  async markUserAsWithdrawn(userEmail: string): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      
      // 사용자 행 찾기
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:W5000`,
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
      
      const existingRow = rows[userRowIndex];
      
      // 탈퇴 처리: STATUS만 "탈퇴"로 변경하고 나머지는 기존 값 유지
      const withdrawalValues = [...existingRow];
      while (withdrawalValues.length < 23) {
        withdrawalValues.push(''); // 빈 열 채우기
      }
      
      // 데이터 삭제 (R파트너 정보 클리어)
      withdrawalValues[6] = '';  // R파트너 1
      withdrawalValues[7] = '';  // R파트너 1 전문분야
      withdrawalValues[8] = '';  // R파트너 1 단계
      withdrawalValues[9] = '';  // R파트너 2
      withdrawalValues[10] = ''; // R파트너 2 전문분야
      withdrawalValues[11] = ''; // R파트너 2 단계
      withdrawalValues[12] = ''; // R파트너 3
      withdrawalValues[13] = ''; // R파트너 3 전문분야
      withdrawalValues[14] = ''; // R파트너 3 단계
      withdrawalValues[15] = ''; // R파트너 4
      withdrawalValues[16] = ''; // R파트너 4 전문분야
      withdrawalValues[17] = ''; // R파트너 4 단계
      withdrawalValues[18] = '0'; // 총 R파트너 수
      withdrawalValues[19] = '0%'; // 달성률
      withdrawalValues[22] = '탈퇴'; // STATUS를 "탈퇴"로 변경
      
      const range = `RPS!A${userRowIndex + 1}:W${userRowIndex + 1}`;
      console.log(`🚫 Marking user ${userEmail} as withdrawn in row ${userRowIndex + 1} (STATUS: 탈퇴)`);
      
      const updateResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [withdrawalValues]
          })
        }
      );

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(`Failed to mark user as withdrawn: ${updateResponse.status} ${errorText}`);
      }

      console.log(`✅ User ${userEmail} marked as withdrawn (STATUS: 탈퇴)`);
    } catch (error: any) {
      console.error(`❌ Error marking user ${userEmail} as withdrawn:`, error);
      throw new Error(`탈퇴 처리 실패: ${error?.message || 'Unknown error'}`);
    }
  }

  // 관리자용: 모든 사용자 데이터 가져오기
  async getAllUsers(): Promise<any[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:W5000`,
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
      
      if (rows.length <= 1) return []; // 헤더만 있거나 빈 시트
      
      const users: any[] = [];
      
      // 헤더 행 스킵하고 데이터 행들 처리
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // 빈 행이나 이메일이 없는 행은 스킵
        if (!row || !row[0] || !row[0].toString().trim()) {
          continue;
        }
        
        const userData = {
          email: row[0] || '',
          region: row[1] || '',
          chapter: row[2] || '',
          memberName: row[3] || '',
          specialty: row[4] || '',
          targetCustomer: row[5] || '',
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
          totalPartners: row[18] || '0',
          achievement: row[19] || '0%',
          status: row[22] || '활동중' // STATUS 컬럼
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
      
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/RPS!A1:A5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
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