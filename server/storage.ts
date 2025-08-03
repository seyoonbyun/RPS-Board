import { type User, type InsertUser, type ScoreboardData, type InsertScoreboardData, type ChangeHistory, type InsertChangeHistory } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
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

export const storage = new MemStorage();
