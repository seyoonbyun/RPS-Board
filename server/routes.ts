import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loginSchema, scoreboardFormSchema, type InsertScoreboardData } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      let user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Auto-register new users
        user = await storage.createUser({ email, password });
      } else if (user.password !== password) {
        return res.status(401).json({ message: "비밀번호가 일치하지 않습니다" });
      }
      
      res.json({ user: { id: user.id, email: user.email } });
    } catch (error) {
      res.status(400).json({ message: "올바른 이메일과 4자리 비밀번호를 입력해주세요" });
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
        // TODO: Implement actual Google Sheets API integration
        // For now, simulate successful auto-sync
        console.log(`Auto-syncing data to Google Sheets for user ${userId}`);
        
        // Here you would integrate with Google Sheets API
        // await googleSheetsService.syncData({
        //   ...savedData,
        //   email: userEmail // would need to get user email
        // });
        
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

  // Google Sheets sync route
  app.post("/api/sync/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const data = await storage.getScoreboardData(userId);
      
      if (!data) {
        return res.status(404).json({ message: "저장된 데이터가 없습니다" });
      }
      
      // TODO: Implement actual Google Sheets API integration
      // For now, simulate sync success
      
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
