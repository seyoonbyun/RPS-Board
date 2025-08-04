import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loginSchema, scoreboardFormSchema, type InsertScoreboardData } from "@shared/schema";
import { z } from "zod";
import { getGoogleSheetsService } from "./google-sheets";
import { PartnerRecommendationEngine } from './partner-recommendation.js';

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
          const googleSheetsData = {
            region: profile.region || '',
            userIdField: '',
            partner: profile.chapter || '',
            memberName: profile.memberName || '',
            specialty: profile.specialty || '',
            targetCustomer: profile.targetCustomer || '',
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
      const formData = scoreboardFormSchema.parse(req.body);
      
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

  // Partner recommendation endpoints - 산업 호환성 기반 추천 엔진  
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

      const recommendations = await recommendationEngine.getPartnerRecommendations(user.email, filters);
      
      res.json({ recommendations });
    } catch (error) {
      console.error("Partner recommendation error:", error);
      res.status(500).json({ message: "파트너 추천 중 오류가 발생했습니다" });
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
