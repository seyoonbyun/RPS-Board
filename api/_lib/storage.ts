import { users, scoreboardData, changeHistory, type User, type InsertUser, type ScoreboardData, type InsertScoreboardData, type ChangeHistory, type InsertChangeHistory } from "./schema.js";
import { db as dbMaybe } from "./db.js";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// Postgres가 없는 환경(시트 전용 모드)에서는 DatabaseStorage 호출 자체가 의미 없음.
// 호출 직전 가드를 통과한 코드 경로에서만 db를 사용한다는 invariant.
function requireDb() {
  if (!dbMaybe) {
    throw new Error('DATABASE_URL not set — DatabaseStorage operations unavailable');
  }
  return dbMaybe;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUserByEmail(user: InsertUser): Promise<{ user: User; isFirst: boolean }>;
  deleteUserData(userId: string): Promise<void>;
  isUserAllowed(email: string, password?: string): Promise<boolean>;
  getScoreboardData(userId: string): Promise<ScoreboardData | undefined>;
  upsertScoreboardData(userId: string, data: InsertScoreboardData): Promise<ScoreboardData>;
  getChangeHistory(userId: string): Promise<ChangeHistory[]>;
  addChangeHistory(change: InsertChangeHistory): Promise<ChangeHistory>;
  getAllUsersFromGoogleSheets(): Promise<any[]>;
  getUserProfileFromGoogleSheets(email: string): Promise<any>;
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

  async upsertUserByEmail(insertUser: InsertUser): Promise<{ user: User; isFirst: boolean }> {
    const existing = await this.getUserByEmail(insertUser.email);
    if (existing) return { user: existing, isFirst: false };
    const created = await this.createUser(insertUser);
    return { user: created, isFirst: true };
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
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const googleSheetsService = getGoogleSheetsService();
    if (!googleSheetsService) return false;
    return await googleSheetsService.checkUserCredentials(email, password || '');
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
      industry: data.industry || null,
      company: data.company || null,
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

  async getAllUsersFromGoogleSheets(): Promise<any[]> {
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const svc = getGoogleSheetsService();
    if (!svc) return [];
    return await svc.getAllUsers();
  }

  async getUserProfileFromGoogleSheets(email: string): Promise<any> {
    const { getGoogleSheetsService } = await import('./google-sheets.js');
    const svc = getGoogleSheetsService();
    if (!svc) return null;
    return await svc.getUserProfile(email);
  }
}

// Database Storage Implementation
export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await requireDb().select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await requireDb().select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await requireDb()
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // 로그인 hot path용: getUserByEmail + createUser 2쿼리 → 1쿼리로 통합
  // xmax=0 이면 INSERT(신규), 그 외는 기존 행 업데이트
  async upsertUserByEmail(insertUser: InsertUser): Promise<{ user: User; isFirst: boolean }> {
    const result: any = await requireDb().execute(
      sql`
        INSERT INTO users (email, password)
        VALUES (${insertUser.email}, ${insertUser.password})
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
        RETURNING id, email, password, created_at, (xmax = 0) AS is_first
      `,
    );
    const row = Array.isArray(result) ? result[0] : result.rows?.[0];
    return {
      user: {
        id: row.id,
        email: row.email,
        password: row.password,
        createdAt: row.created_at,
      } as User,
      isFirst: !!row.is_first,
    };
  }

  async deleteUserData(userId: string): Promise<void> {
    // Delete user data from database in transaction
    await requireDb().transaction(async (tx) => {
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
    const [data] = await requireDb().select().from(scoreboardData).where(eq(scoreboardData.userId, userId));
    return data || undefined;
  }

  async upsertScoreboardData(userId: string, data: InsertScoreboardData): Promise<ScoreboardData> {
    const existing = await this.getScoreboardData(userId);
    
    if (existing) {
      const [updated] = await requireDb()
        .update(scoreboardData)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(scoreboardData.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await requireDb()
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
    return await requireDb().select().from(changeHistory).where(eq(changeHistory.userId, userId));
  }

  async addChangeHistory(change: InsertChangeHistory): Promise<ChangeHistory> {
    const [created] = await requireDb()
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

export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();
