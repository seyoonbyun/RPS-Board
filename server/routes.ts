import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { loginSchema, scoreboardFormSchema, scoreboardPartialUpdateSchema, type InsertScoreboardData } from "@shared/schema";
import { z } from "zod";
import { getGoogleSheetsService } from "./google-sheets";
import { PartnerRecommendationEngine } from './partner-recommendation.js';
import { ObjectStorageService } from "./objectStorage";
import * as iconv from 'iconv-lite';

// Multer 설정 - 메모리에 파일 저장
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('CSV 파일만 업로드 가능합니다.'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      // First check if user credentials are valid in Google Sheets (V and M columns)
      try {
        const isAllowed = await storage.isUserAllowed(email, password);
        if (!isAllowed) {
          return res.status(403).json({ 
            message: "구글 시트에 등록되지 않았거나 잘못된 인증 정보입니다. 관리자에게 문의하세요." 
          });
        }
      } catch (error: any) {
        if (error.message === 'WITHDRAWN_USER') {
          return res.status(403).json({ 
            message: "탈퇴한 계정입니다. 관리자에게 계정 복구를 요청하세요." 
          });
        }
        throw error;
      }
      
      let user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Auto-register new users (only if credentials validated in Google Sheets)
        user = await storage.createUser({ email, password });
      }
      // Note: Password validation is now done against Google Sheets, not local storage
      
      res.json({ user: { id: user.id, email: user.email } });
    } catch (error) {
      console.error("Login error:", error);
      res.status(400).json({ message: "올바른 이메일과 4자리 비밀번호를 입력해주세요" });
    }
  });

  // Get user profile from Google Sheets with auto-sync
  app.get("/api/user-profile/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }

      // Get user profile from Google Sheets
      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }
      const profile = await googleSheetsService.getUserProfile(user.email);
      
      if (profile) {
        // 완전한 양방향 동기화 - Google Sheets 변경사항을 로컬 데이터베이스에 반영
        try {
          const existingData = await storage.getScoreboardData(userId);
          
          // Google Sheets 데이터를 로컬 데이터베이스 형태로 변환
          // 양방향 연동 필드는 로컬 데이터를 우선시함
          const googleSheetsData = {
            region: profile.region || '',
            userIdField: '',
            partner: profile.chapter || '',
            memberName: profile.memberName || '',
            industry: profile.industry || '',
            company: profile.company || '',
            specialty: existingData?.specialty || profile.specialty || '',
            targetCustomer: existingData?.targetCustomer || profile.targetCustomer || '',
            rpartner1: profile.rpartner1 || '',
            rpartner1Specialty: profile.rpartner1Specialty || '',
            rpartner1Stage: profile.rpartner1Stage || '',
            rpartner2: profile.rpartner2 || '',
            rpartner2Specialty: profile.rpartner2Specialty || '',
            rpartner2Stage: profile.rpartner2Stage || '',
            rpartner3: profile.rpartner3 || '',
            rpartner3Specialty: profile.rpartner3Specialty || '',
            rpartner3Stage: profile.rpartner3Stage || '',
            rpartner4: profile.rpartner4 || '',
            rpartner4Specialty: profile.rpartner4Specialty || '',
            rpartner4Stage: profile.rpartner4Stage || '',
          };

          console.log(`🔄 Syncing Google Sheets data to local database for ${user.email}:`, {
            rpartner1: googleSheetsData.rpartner1,
            rpartner4: googleSheetsData.rpartner4,
            existingR1: existingData?.rpartner1,
            existingR4: existingData?.rpartner4
          });

          // 변경사항이 있는지 확인하고 업데이트
          const hasChanges = !existingData || Object.keys(googleSheetsData).some(key => 
            existingData[key as keyof typeof existingData] !== googleSheetsData[key as keyof typeof googleSheetsData]
          );

          if (hasChanges) {
            const updatedData = await storage.upsertScoreboardData(userId, googleSheetsData);
            console.log(`✅ Updated local database with Google Sheets data for ${user.email}`);
            
            // 변경 내역 추가
            if (existingData) {
              const changes = await trackChanges(userId, existingData, googleSheetsData);
              for (const change of changes) {
                await storage.addChangeHistory({
                  userId,
                  fieldName: `[구글시트 동기화] ${change.field}`,
                  oldValue: change.oldValue,
                  newValue: change.newValue,
                });
              }
              if (changes.length > 0) {
                console.log(`📝 Tracked ${changes.length} changes from Google Sheets for ${user.email}`);
              }
            }
          } else {
            console.log(`⚡ No changes detected for ${user.email}`);
          }
        } catch (syncError) {
          console.error('❌ Google Sheets to local sync failed:', syncError);
          // 동기화 실패 시에도 사용자에게는 기본 프로필 정보 제공
        }
      }
      
      res.json(profile);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ message: "프로필을 불러오는데 실패했습니다" });
    }
  });

  // Scoreboard data routes
  app.get("/api/scoreboard/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const data = await storage.getScoreboardData(userId);
      
      if (!data) {
        return res.json(null);
      }
      
      res.json(data);
    } catch (error) {
      res.status(500).json({ message: "데이터를 불러오는데 실패했습니다" });
    }
  });

  app.post("/api/scoreboard/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const formData = scoreboardPartialUpdateSchema.parse(req.body);
      
      // Get existing data for change tracking
      const existingData = await storage.getScoreboardData(userId);
      
      // Save new data
      const savedData = await storage.upsertScoreboardData(userId, formData);
      
      // Track changes
      if (existingData) {
        const changes = await trackChanges(userId, existingData, formData);
        
        // Log changes to history
        for (const change of changes) {
          await storage.addChangeHistory({
            userId,
            fieldName: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
          });
        }
      }

      // Automatically sync to Google Sheets after saving - 강화된 실시간 동기화
      try {
        // Get user's email for Google Sheets sync
        const user = await storage.getUserById(userId);
        if (user) {
          console.log('🔄 Starting ENHANCED Google Sheets sync with validated data:', JSON.stringify(formData, null, 2));
          console.log(`🔄 User: ${user.email}, Data saved:`, savedData);
          
          const sheetsService = getGoogleSheetsService();
          if (sheetsService) {
            // 실시간 달성률 계산 강화
            const partners = [
              { name: savedData.rpartner1, stage: savedData.rpartner1Stage },
              { name: savedData.rpartner2, stage: savedData.rpartner2Stage },
              { name: savedData.rpartner3, stage: savedData.rpartner3Stage },
              { name: savedData.rpartner4, stage: savedData.rpartner4Stage },
            ];
            
            const profitPartners = partners.filter(p => p.name && p.name.trim() && p.stage === 'P').length;
            const achievement = Math.round((profitPartners / 4) * 100);
            
            console.log(`🔄 Real-time achievement calculation:`, {
              partners,
              profitPartners,
              achievement: `${achievement}%`
            });
            
            await sheetsService.syncScoreboardData({
              ...savedData,
              userEmail: user.email
            });
            console.log(`✅ Successfully synced data to Google Sheets for ${user.email} with ${profitPartners} profit partners (${achievement}%)`);
          }
        }
      } catch (syncError) {
        console.error('Google Sheets auto-sync failed:', syncError);
        // Don't fail the main request if sync fails
      }
      
      res.json(savedData);
    } catch (error) {
      console.error('Error in POST /api/scoreboard:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "입력 데이터를 확인해주세요", errors: error.errors });
      }
      res.status(500).json({ message: "데이터 저장에 실패했습니다" });
    }
  });

  // Change history routes
  app.get("/api/changes/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const changes = await storage.getChangeHistory(userId);
      res.json(changes);
    } catch (error) {
      res.status(500).json({ message: "변경 내역을 불러오는데 실패했습니다" });
    }
  });

  // Sync from Google Sheets to local database
  app.post("/api/sync-from-sheets/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }

      // Get latest data from Google Sheets
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }
      const profile = await sheetsService.getUserProfile(user.email);
      
      if (!profile) {
        return res.status(404).json({ message: "구글 시트에서 사용자 프로필을 찾을 수 없습니다" });
      }

      // Get current local data for change tracking
      const existingData = await storage.getScoreboardData(userId);

      // Update local scoreboard data with Google Sheets data (preserve targetCustomer from local if exists)
      const updatedData = {
        region: profile.region || '',
        userIdField: '',
        partner: profile.chapter || '',
        memberName: profile.memberName || '',
        specialty: profile.specialty || '',
        targetCustomer: existingData?.targetCustomer || profile.targetCustomer || '',
        rpartner1: profile.rpartner1 || '',
        rpartner1Specialty: profile.rpartner1Specialty || '',
        rpartner1Stage: profile.rpartner1Stage || '',
        rpartner2: profile.rpartner2 || '',
        rpartner2Specialty: profile.rpartner2Specialty || '',
        rpartner2Stage: profile.rpartner2Stage || '',
        rpartner3: profile.rpartner3 || '',
        rpartner3Specialty: profile.rpartner3Specialty || '',
        rpartner3Stage: profile.rpartner3Stage || '',
        rpartner4: profile.rpartner4 || '',
        rpartner4Specialty: profile.rpartner4Specialty || '',
        rpartner4Stage: profile.rpartner4Stage || '',
      };

      const updatedScoreboard = await storage.upsertScoreboardData(userId, updatedData);

      // Track changes for sync from sheets
      if (existingData) {
        const changes = await trackChanges(userId, existingData, updatedData);
        
        // Log changes to history with special sync marker
        for (const change of changes) {
          await storage.addChangeHistory({
            userId,
            fieldName: `[구글시트동기화] ${change.field}`,
            oldValue: change.oldValue,
            newValue: change.newValue,
          });
        }
      }

      res.json({ 
        message: "구글 시트에서 성공적으로 동기화했습니다",
        data: updatedScoreboard,
        changes: existingData ? await trackChanges(userId, existingData, updatedData) : []
      });
    } catch (error) {
      console.error('Error syncing from Google Sheets:', error);
      res.status(500).json({ message: "구글 시트 동기화에 실패했습니다" });
    }
  });

  // Google Sheets sync route (to sheets)
  app.post("/api/sync/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const data = await storage.getScoreboardData(userId);
      
      if (!data) {
        return res.status(404).json({ message: "저장된 데이터가 없습니다" });
      }
      
      // Get user's email for Google Sheets sync
      const user = await storage.getUserById(userId);
      if (user) {
        const sheetsService = getGoogleSheetsService();
        if (sheetsService) {
          await sheetsService.syncScoreboardData({
            ...data,
            userEmail: user.email
          });
        }
      }
      
      res.json({ message: "구글 시트와 동기화가 완료되었습니다", timestamp: new Date() });
    } catch (error) {
      res.status(500).json({ message: "동기화에 실패했습니다" });
    }
  });

  // User withdrawal/deletion endpoint - 사용자 탈퇴 처리
  app.delete("/api/user-withdrawal/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }

      // Get current user profile from Google Sheets
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const profile = await sheetsService.getUserProfile(user.email);
      if (!profile) {
        return res.status(404).json({ message: "구글 시트에서 사용자 프로필을 찾을 수 없습니다" });
      }

      // Mark user as withdrawn in Google Sheets - STATUS를 "탈퇴"로 변경
      await sheetsService.markUserAsWithdrawn(user.email);

      // Delete user data from local database
      await storage.deleteUserData(userId);

      res.json({ 
        message: "탈퇴 처리가 완료되었습니다",
        withdrawnUser: {
          region: profile.region,
          chapter: profile.chapter,
          memberName: profile.memberName,
          email: user.email
        }
      });
    } catch (error) {
      console.error('Error in user withdrawal:', error);
      res.status(500).json({ message: "탈퇴 처리 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Get all users
  // Admin permission check route
  app.post("/api/admin/check-permission", async (req, res) => {
    try {
      // Get user email from request body
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "이메일이 필요합니다", isAdmin: false });
      }
      
      const userEmail = email;

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다", isAdmin: false });
      }

      const isAdmin = await googleSheetsService.checkAdminPermission(userEmail);
      const userAuth = await googleSheetsService.getUserAuth(userEmail);
      res.json({ isAdmin, auth: userAuth });
      
    } catch (error) {
      console.error('Admin permission check error:', error);
      res.status(500).json({ message: "관리자 권한 확인 중 오류가 발생했습니다", isAdmin: false });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const allUsersData = await storage.getAllUsersFromGoogleSheets();
      res.json(allUsersData);
    } catch (error: any) {
      console.error("❌ Error fetching all users:", error);
      res.status(500).json({ message: "사용자 목록 조회 실패" });
    }
  });

  // Admin API: Bulk withdrawal
  app.post("/api/admin/bulk-withdrawal", async (req, res) => {
    try {
      const { userEmails } = req.body;
      
      if (!userEmails || !Array.isArray(userEmails) || userEmails.length === 0) {
        return res.status(400).json({ message: "유효한 이메일 목록을 제공해주세요" });
      }

      console.log(`🔄 Starting bulk withdrawal for ${userEmails.length} users:`, userEmails);
      
      let processedCount = 0;
      const errors: string[] = [];

      for (const email of userEmails) {
        try {
          // Check if user exists in Google Sheets
          const profile = await storage.getUserProfileFromGoogleSheets(email);
          if (!profile) {
            errors.push(`${email}: 사용자를 찾을 수 없습니다`);
            continue;
          }

          // Mark user as withdrawn in Google Sheets
          const sheetsService = getGoogleSheetsService();
          if (!sheetsService) {
            errors.push(`${email}: 구글 시트 서비스 초기화 실패`);
            continue;
          }
          
          await sheetsService.markUserAsWithdrawn(email);
          
          // Delete local user data if exists
          const localUser = await storage.getUserByEmail(email);
          if (localUser) {
            await storage.deleteUserData(localUser.id);
          }

          processedCount++;
          console.log(`✅ Bulk withdrawal completed for ${email}`);
        } catch (error: any) {
          console.error(`❌ Bulk withdrawal error for ${email}:`, error);
          errors.push(`${email}: ${error.message}`);
        }
      }

      const responseMessage = `${processedCount}명 탈퇴 처리 완료`;
      const response: any = { 
        message: responseMessage,
        processedCount,
        totalRequested: userEmails.length
      };

      if (errors.length > 0) {
        response.errors = errors;
        response.message += ` (${errors.length}건 실패)`;
      }

      res.json(response);
    } catch (error: any) {
      console.error("❌ Bulk withdrawal error:", error);
      res.status(500).json({ message: error.message || "일괄 탈퇴 처리 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Add single user
  app.post("/api/admin/add-user", async (req, res) => {
    try {
      const { email, region, chapter, memberName, industry, company, specialty, targetCustomer, password, auth } = req.body;
      
      if (!email || !memberName) {
        return res.status(400).json({ message: "이메일과 멤버명은 필수 항목입니다" });
      }

      console.log(`🔄 Adding new user: ${email}`);
      
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }
      
      await sheetsService.addNewUser({
        email,
        region: region || '',
        chapter: chapter || '',
        memberName,
        industry: industry || '',
        company: company || '',
        specialty: specialty || '',
        targetCustomer: '', // 관리자 추가 시 타겟고객은 빈 값으로 설정 (사용자가 직접 입력)
        password: password || '1234', // 기본 비밀번호
        auth: auth || 'Member' // 기본 권한
      });
      
      console.log(`✅ New user added successfully: ${email}`);
      res.json({ message: "사용자가 성공적으로 추가되었습니다", email });
      
    } catch (error: any) {
      console.error(`❌ Error adding user:`, error);
      if (error.message.includes('already exists')) {
        res.status(409).json({ message: "이미 존재하는 사용자입니다" });
      } else {
        res.status(500).json({ message: "사용자 추가 중 오류가 발생했습니다" });
      }
    }
  });

  // Admin API: Bulk add users
  app.post("/api/admin/bulk-add-users", async (req, res) => {
    try {
      const { users } = req.body;
      
      if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ message: "유효한 사용자 목록을 제공해주세요" });
      }

      console.log(`🔄 Starting bulk user addition for ${users.length} users`);
      
      let processedCount = 0;
      const errors: string[] = [];

      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          if (!user.email || !user.memberName) {
            errors.push(`${user.email || 'Unknown'}: 이메일과 멤버명은 필수 항목입니다`);
            continue;
          }

          console.log(`🔄 Processing user ${i + 1}/${users.length}: ${user.email}`, {
            password: user.password || '1234',
            auth: user.auth || 'Member'
          });

          await sheetsService.addNewUser({
            email: user.email,
            region: user.region || '',
            chapter: user.chapter || '',
            memberName: user.memberName,
            industry: user.industry || '',
            company: user.company || '',
            specialty: user.specialty || '',
            targetCustomer: user.targetCustomer || '',
            password: user.password || '1234',
            auth: user.auth || 'Member'
          });

          processedCount++;
          console.log(`✅ Bulk addition completed for ${user.email}`);
        } catch (error: any) {
          console.error(`❌ Bulk addition error for ${user.email}:`, error);
          if (error.message.includes('already exists')) {
            errors.push(`${user.email}: 이미 존재하는 사용자입니다`);
          } else {
            errors.push(`${user.email}: ${error.message}`);
          }
        }
      }

      const responseMessage = `${processedCount}명 추가 완료`;
      const response: any = { 
        message: responseMessage,
        processedCount,
        totalRequested: users.length
      };

      if (errors.length > 0) {
        response.errors = errors;
        response.message += ` (${errors.length}개 오류)`;
      }

      console.log(`📊 Bulk user addition processed: ${processedCount}/${users.length} users`);
      res.json(response);
    } catch (error: any) {
      console.error("❌ Error in bulk user addition:", error);
      res.status(500).json({ message: "일괄 사용자 추가 중 오류가 발생했습니다" });
    }
  });

  // CSV Upload endpoints for bulk user addition
  app.post("/api/csv/upload-url", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getCSVUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error generating CSV upload URL:", error);
      res.status(500).json({ error: "업로드 URL 생성 실패" });
    }
  });

  app.post("/api/csv/process", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "CSV 파일이 필요합니다" });
      }

      // 파일 버퍼에서 텍스트 추출 (인코딩 감지 및 변환)
      let csvContent: string;
      try {
        // UTF-8로 시도
        csvContent = req.file.buffer.toString('utf8');
        
        // 한글이 깨져 보이면 다른 인코딩 시도
        if (csvContent.includes('�') || !/[\u3131-\u314e\u314f-\u3163\uac00-\ud7a3]/.test(csvContent)) {
          console.log('🔄 UTF-8 감지 실패, EUC-KR/CP949 시도...');
          csvContent = iconv.decode(req.file.buffer, 'euc-kr');
          
          // 여전히 실패하면 CP949 시도
          if (csvContent.includes('�') || !/[\u3131-\u314e\u314f-\u3163\uac00-\ud7a3]/.test(csvContent)) {
            console.log('🔄 EUC-KR 감지 실패, CP949 시도...');
            csvContent = iconv.decode(req.file.buffer, 'cp949');
          }
        }
        
        console.log('✅ CSV 인코딩 감지 및 변환 완료');
      } catch (error) {
        console.error('❌ CSV 인코딩 변환 실패:', error);
        csvContent = req.file.buffer.toString('utf8'); // 기본값으로 폴백
      }
      
      // Parse CSV content using the same logic as the text input
      const lines = csvContent.trim().split('\n');
      const errors: string[] = [];
      
      // 헤더 행 건너뛰기 - 첫 번째 행이 헤더인지 확인
      let dataLines = lines;
      if (lines.length > 0) {
        const firstLine = lines[0].toLowerCase();
        // 헤더로 보이는 키워드들이 포함된 경우 첫 번째 행 제외
        if (firstLine.includes('id') || firstLine.includes('이메일') || firstLine.includes('email') || 
            firstLine.includes('region') || firstLine.includes('지역') || firstLine.includes('member')) {
          console.log('📋 Header row detected, skipping first line:', lines[0]);
          dataLines = lines.slice(1);
        }
      }
      
      // 권한 키워드 매핑 함수
      const normalizeAuthKeyword = (keyword: string): string | null => {
        const lower = keyword.toLowerCase();
        if (lower === 'admin' || lower === 'ADMIN'.toLowerCase() || lower === '어드민') {
          return 'Admin';
        }
        if (lower === 'growth' || lower === 'GROWTH'.toLowerCase() || lower === '성장') {
          return 'Growth';
        }
        if (lower === 'member' || lower === 'MEMBER'.toLowerCase() || lower === '멤버') {
          return 'Member';
        }
        return null;
      };

      const users = dataLines.map((line, index) => {
        console.log(`🔍 Parsing line ${index + 1}: "${line}"`);
        const parts = line.split(',').map(part => part.trim());
        console.log(`📝 Parts array:`, parts);
        
        // 최소 5개 필드 필요: 이메일, 지역, 챕터, 멤버명, 전문분야
        if (parts.length < 5) {
          throw new Error(`Line ${index + 1}: 최소 5개 필드(이메일, 지역, 챕터, 멤버명, 전문분야)가 필요합니다`);
        }
        
        // 필드 개수에 따라 유연하게 처리
        let password = '1234';
        let auth = 'Member';

        // 6번째와 7번째 필드에서 권한과 비밀번호 찾기 (인덱스는 0부터 시작)
        if (parts.length >= 6) {
          const field5 = parts[5];  // 6번째 필드
          const field6 = parts.length >= 7 ? parts[6] : undefined;  // 7번째 필드
          
          const field5Auth = normalizeAuthKeyword(field5);
          const field6Auth = field6 ? normalizeAuthKeyword(field6) : null;
          
          console.log(`🔍 Field analysis for ${parts[0]}:`, {
            partsLength: parts.length,
            field5: field5,
            field6: field6,
            field5Auth: field5Auth,
            field6Auth: field6Auth
          });
          
          // 두 필드 중 권한이 있는 것을 찾아서 할당
          if (field5Auth && field6Auth) {
            // 둘 다 권한이면 첫 번째를 권한으로, 두 번째를 비밀번호로 (하지만 이는 이상한 경우)
            auth = field5Auth;
            password = field6 || '1234';
          } else if (field5Auth) {
            // 6번째가 권한이면
            auth = field5Auth;
            if (field6) password = field6;
          } else if (field6Auth) {
            // 7번째가 권한이면
            auth = field6Auth;
            password = field5;
          } else {
            // 둘 다 권한이 아니면 6번째를 비밀번호로 처리
            password = field5;
            // field6이 없으면 auth는 기본값 'Member' 유지
          }
        }

        const user = {
          email: parts[0],
          region: parts[1] || '',
          chapter: parts[2] || '',
          memberName: parts[3],
          industry: parts[4] || '',
          company: parts[5] || '',
          specialty: parts[6] || '',
          targetCustomer: '', // 관리자 추가 시 타겟고객은 빈 값으로 설정
          password: password,
          auth: auth
        };
        
        console.log(`👤 Parsed user ${index + 1}:`, {
          email: user.email,
          password: user.password,
          auth: user.auth
        });
        
        return user;
      });

      // Process users in bulk using existing logic
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      let processedCount = 0;
      
      console.log(`🔄 Starting bulk user addition via CSV for ${users.length} users`);

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          if (!user.email || !user.memberName) {
            errors.push(`${user.email || 'Unknown'}: 이메일과 멤버명은 필수 항목입니다`);
            continue;
          }

          console.log(`🔄 Processing user ${i + 1}/${users.length}: ${user.email}`, {
            password: user.password || '1234',
            auth: user.auth || 'Member'
          });

          await sheetsService.addNewUser({
            email: user.email,
            region: user.region || '',
            chapter: user.chapter || '',
            memberName: user.memberName,
            industry: user.industry || '',
            company: user.company || '',
            specialty: user.specialty || '',
            targetCustomer: user.targetCustomer || '',
            password: user.password || '1234',
            auth: user.auth || 'Member'
          });

          processedCount++;
          console.log(`✅ CSV bulk addition completed for ${user.email}`);
        } catch (error: any) {
          console.error(`❌ CSV bulk addition error for ${user.email}:`, error);
          if (error.message.includes('already exists')) {
            errors.push(`${user.email}: 이미 존재하는 사용자입니다`);
          } else {
            errors.push(`${user.email}: ${error.message}`);
          }
        }
      }

      const responseMessage = `CSV 파일 처리 완료: ${processedCount}명 추가`;
      const response: any = { 
        message: responseMessage,
        processedCount,
        totalRequested: users.length
      };

      if (errors.length > 0) {
        response.errors = errors;
        response.message += ` (${errors.length}개 오류)`;
      }

      console.log(`📊 CSV bulk user addition processed: ${processedCount}/${users.length} users`);
      res.json(response);
      
    } catch (error: any) {
      console.error("Error processing CSV:", error);
      res.status(500).json({ error: "CSV 처리 실패", details: error.message });
    }
  });

  // 선택한 멤버 복원 API
  app.post("/api/admin/restore-users", async (req, res) => {
    try {
      const { userEmails } = req.body;
      
      if (!Array.isArray(userEmails) || userEmails.length === 0) {
        return res.status(400).json({ message: "복원할 사용자 이메일 목록이 필요합니다" });
      }

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      let restoredCount = 0;
      const errors: string[] = [];

      console.log(`🔄 Starting bulk user restoration for ${userEmails.length} users`);

      for (const email of userEmails) {
        try {
          await sheetsService.updateUserStatus(email, '활동중');
          restoredCount++;
          console.log(`✅ User ${email} restored successfully`);
        } catch (error: any) {
          console.error(`❌ Error restoring user ${email}:`, error);
          errors.push(`${email}: ${error.message}`);
        }
      }

      const responseMessage = `${restoredCount}명의 멤버가 성공적으로 복원되었습니다`;
      const response: any = { 
        message: responseMessage,
        restoredCount,
        totalRequested: userEmails.length
      };

      if (errors.length > 0) {
        response.errors = errors;
        response.message += ` (${errors.length}개 오류)`;
      }

      console.log(`📊 Bulk user restoration completed: ${restoredCount}/${userEmails.length} users restored`);
      res.json(response);
      
    } catch (error: any) {
      console.error("Error restoring users:", error);
      res.status(500).json({ message: "멤버 복원 중 오류가 발생했습니다", details: error.message });
    }
  });

  // Business Synergy Partner Recommendations - 비즈니스 시너지 기반 추천 엔진  
  app.get("/api/partner-recommendations/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const { region, chapter, minScore, excludeCurrent, maxResults } = req.query;
      
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const { PartnerRecommendationEngine } = await import('./partner-recommendation.js');
      const recommendationEngine = new PartnerRecommendationEngine(googleSheetsService);

      const filters = {
        region: region as string,
        chapter: chapter as string,
        minCompatibilityScore: minScore ? parseInt(minScore as string) : undefined,
        excludeCurrentPartners: excludeCurrent === 'true',
        maxResults: maxResults ? parseInt(maxResults as string) : 10
      };

      const recommendations = await recommendationEngine.getBusinessSynergyRecommendations(user.email, filters);
      
      res.json({ recommendations });
    } catch (error) {
      console.error("Business synergy recommendation error:", error);
      res.status(500).json({ message: "비즈니스 시너지 파트너 추천 중 오류가 발생했습니다" });
    }
  });

  // Industry analytics endpoint
  app.get("/api/industry-analytics", async (req, res) => {
    try {
      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const { PartnerRecommendationEngine } = await import('./partner-recommendation.js');
      const recommendationEngine = new PartnerRecommendationEngine(googleSheetsService);
      
      const analytics = await recommendationEngine.getIndustryAnalytics();
      
      res.json(analytics);
    } catch (error) {
      console.error("Industry analytics error:", error);
      res.status(500).json({ message: "업종 분석 중 오류가 발생했습니다" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function trackChanges(userId: string, oldData: any, newData: any) {
  const changes = [];
  const fieldLabels: Record<string, string> = {
    region: "지역",
    userIdField: "ID",
    partner: "파트너",
    memberName: "멤버명",
    specialty: "전문분야",
    targetCustomer: "핵심 고객층",
    rpartner1: "R파트너1",
    rpartner1Specialty: "R파트너1 전문분야",
    rpartner1Stage: "R파트너1 단계",
    rpartner2: "R파트너2",
    rpartner2Specialty: "R파트너2 전문분야",
    rpartner2Stage: "R파트너2 단계",
    rpartner3: "R파트너3",
    rpartner3Specialty: "R파트너3 전문분야",
    rpartner3Stage: "R파트너3 단계",
    rpartner4: "R파트너4",
    rpartner4Specialty: "R파트너4 전문분야",
    rpartner4Stage: "R파트너4 단계",
  };

  for (const field in fieldLabels) {
    if (oldData[field] !== newData[field]) {
      changes.push({
        field: fieldLabels[field],
        oldValue: oldData[field] || "",
        newValue: newData[field] || "",
      });
    }
  }

  return changes;
}
