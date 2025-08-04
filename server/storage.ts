import { users, scoreboardData, changeHistory, type User, type InsertUser, type ScoreboardData, type InsertScoreboardData, type ChangeHistory, type InsertChangeHistory } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  deleteUserData(userId: string): Promise<void>;
  isUserAllowed(email: string, password?: string): Promise<boolean>;
  getScoreboardData(userId: string): Promise<ScoreboardData | undefined>;
  upsertScoreboardData(userId: string, data: InsertScoreboardData): Promise<ScoreboardData>;
  getChangeHistory(userId: string): Promise<ChangeHistory[]>;
  addChangeHistory(change: InsertChangeHistory): Promise<ChangeHistory>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private scoreboardData: Map<string, ScoreboardData>;
  private changeHistory: Map<string, ChangeHistory[]>;

  constructor() {
    this.users = new Map();
    this.scoreboardData = new Map();
    this.changeHistory = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async deleteUserData(userId: string): Promise<void> {
    // Delete user from users map
    this.users.delete(userId);
    
    // Delete scoreboard data for this user
    const scoreboardEntries = Array.from(this.scoreboardData.entries());
    for (const [key, data] of scoreboardEntries) {
      if (data.userId === userId) {
        this.scoreboardData.delete(key);
      }
    }
    
    // Delete change history for this user
    this.changeHistory.delete(userId);
  }

  async isUserAllowed(email: string, password?: string): Promise<boolean> {
    // For memory storage, we'll check Google Sheets directly
    // This is implemented in the DatabaseStorage class
    return true;
  }

  async getScoreboardData(userId: string): Promise<ScoreboardData | undefined> {
    return Array.from(this.scoreboardData.values()).find(
      (data) => data.userId === userId,
    );
  }

  async upsertScoreboardData(userId: string, data: InsertScoreboardData): Promise<ScoreboardData> {
    const existing = await this.getScoreboardData(userId);
    const id = existing?.id || randomUUID();
    
    const scoreboardData: ScoreboardData = {
      id,
      userId,
      region: data.region || null,
      userIdField: data.userIdField || null,
      partner: data.partner || null,
      memberName: data.memberName || null,
      specialty: data.specialty || null,
      targetCustomer: data.targetCustomer || null,
      rpartner1: data.rpartner1 || null,
      rpartner1Specialty: data.rpartner1Specialty || null,
      rpartner1Stage: data.rpartner1Stage || null,
      rpartner2: data.rpartner2 || null,
      rpartner2Specialty: data.rpartner2Specialty || null,
      rpartner2Stage: data.rpartner2Stage || null,
      rpartner3: data.rpartner3 || null,
      rpartner3Specialty: data.rpartner3Specialty || null,
      rpartner3Stage: data.rpartner3Stage || null,
      rpartner4: data.rpartner4 || null,
      rpartner4Specialty: data.rpartner4Specialty || null,
      rpartner4Stage: data.rpartner4Stage || null,
      updatedAt: new Date(),
    };
    
    this.scoreboardData.set(id, scoreboardData);
    return scoreboardData;
  }

  async getChangeHistory(userId: string): Promise<ChangeHistory[]> {
    return this.changeHistory.get(userId) || [];
  }

  async addChangeHistory(change: InsertChangeHistory): Promise<ChangeHistory> {
    const id = randomUUID();
    const changeRecord: ChangeHistory = {
      id,
      userId: change.userId,
      fieldName: change.fieldName,
      oldValue: change.oldValue || null,
      newValue: change.newValue || null,
      timestamp: new Date(),
    };
    
    const userHistory = this.changeHistory.get(change.userId) || [];
    userHistory.unshift(changeRecord);
    
    // Keep only last 50 changes
    if (userHistory.length > 50) {
      userHistory.splice(50);
    }
    
    this.changeHistory.set(change.userId, userHistory);
    return changeRecord;
  }
}

// Database Storage Implementation
export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async deleteUserData(userId: string): Promise<void> {
    // Delete user data from database in transaction
    await db.transaction(async (tx) => {
      // Delete change history first (foreign key constraint)
      await tx.delete(changeHistory).where(eq(changeHistory.userId, userId));
      
      // Delete scoreboard data
      await tx.delete(scoreboardData).where(eq(scoreboardData.userId, userId));
      
      // Delete user
      await tx.delete(users).where(eq(users.id, userId));
    });
  }

  async isUserAllowed(email: string, password?: string): Promise<boolean> {
    // Check Google Sheets for allowed users
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const googleSheetsService = getGoogleSheetsService();
    if (!googleSheetsService) {
      throw new Error('Google Sheets service not initialized');
    }
    return await googleSheetsService.checkUserCredentials(email, password || '');
  }

  async getScoreboardData(userId: string): Promise<ScoreboardData | undefined> {
    const [data] = await db.select().from(scoreboardData).where(eq(scoreboardData.userId, userId));
    return data || undefined;
  }

  async upsertScoreboardData(userId: string, data: InsertScoreboardData): Promise<ScoreboardData> {
    const existing = await this.getScoreboardData(userId);
    
    if (existing) {
      const [updated] = await db
        .update(scoreboardData)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(scoreboardData.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(scoreboardData)
        .values({
          userId,
          ...data,
        })
        .returning();
      return created;
    }
  }

  async getChangeHistory(userId: string): Promise<ChangeHistory[]> {
    return await db.select().from(changeHistory).where(eq(changeHistory.userId, userId));
  }

  async addChangeHistory(change: InsertChangeHistory): Promise<ChangeHistory> {
    const [created] = await db
      .insert(changeHistory)
      .values(change)
      .returning();
    return created;
  }

  async getAllUsersFromGoogleSheets(): Promise<any[]> {
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const googleSheetsService = getGoogleSheetsService();
    if (!googleSheetsService) {
      throw new Error('Google Sheets service not available');
    }
    return await googleSheetsService.getAllUsers();
  }

  async getUserProfileFromGoogleSheets(email: string): Promise<any> {
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const googleSheetsService = getGoogleSheetsService();
    if (!googleSheetsService) {
      return null;
    }
    return await googleSheetsService.getUserProfile(email);
  }
}

export const storage = new DatabaseStorage();
