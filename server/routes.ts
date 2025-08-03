import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loginSchema, scoreboardFormSchema, type InsertScoreboardData } from "@shared/schema";
import { z } from "zod";
import { getGoogleSheetsService } from "./google-sheets";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      // First check if user credentials are valid in Google Sheets (V and M columns)
      const isAllowed = await storage.isUserAllowed(email, password);
      if (!isAllowed) {
        return res.status(403).json({ 
          message: "구글 시트에 등록되지 않았거나 잘못된 인증 정보입니다. 관리자에게 문의하세요." 
        });
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
        // Auto-sync from Google Sheets to local database
        try {
          const existingData = await storage.getScoreboardData(userId);

          // Update local scoreboard data with Google Sheets data
          const updatedData = {
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

          // Only update if there are actual changes
          const hasChanges = !existingData || Object.keys(updatedData).some(key => 
            existingData[key as keyof typeof existingData] !== updatedData[key as keyof typeof updatedData]
          );

          if (hasChanges) {
            await storage.upsertScoreboardData(userId, updatedData);

            // Track changes for auto-sync with special marker
            if (existingData) {
              const changes = await trackChanges(userId, existingData, updatedData);
              
              for (const change of changes) {
                await storage.addChangeHistory({
                  userId,
                  fieldName: `[자동동기화] ${change.field}`,
                  oldValue: change.oldValue,
                  newValue: change.newValue,
                });
              }
              
              if (changes.length > 0) {
                console.log(`Auto-synced ${changes.length} changes from Google Sheets for ${user.email}`);
              }
            }
          }

          // 항상 달성율을 다시 계산하여 구글 시트에 업데이트
          try {
            const { getGoogleSheetsService } = await import('./google-sheets.js');
            const googleSheetsService = getGoogleSheetsService();
            if (googleSheetsService) {
              await googleSheetsService.syncScoreboardData({
                ...updatedData,
                userEmail: user.email
              });
              console.log(`Updated achievement rate in Google Sheets for ${user.email}`);
            }
          } catch (syncError) {
            console.error('Failed to update Google Sheets achievement rate:', syncError);
          }
        } catch (syncError) {
          console.error('Auto-sync failed:', syncError);
          // Don't fail the main request if auto-sync fails
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

      // Automatically sync to Google Sheets after saving
      try {
        // Get user's email for Google Sheets sync
        const user = await storage.getUserById(userId);
        if (user) {
          const sheetsService = getGoogleSheetsService();
          if (sheetsService) {
            await sheetsService.syncScoreboardData({
              ...savedData,
              userEmail: user.email
            });
            console.log(`Successfully synced data to Google Sheets for ${user.email}`);
          }
        }
      } catch (syncError) {
        console.error('Google Sheets auto-sync failed:', syncError);
        // Don't fail the main request if sync fails
      }
      
      res.json(savedData);
    } catch (error) {
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

      // Update local scoreboard data with Google Sheets data
      const updatedData = {
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
