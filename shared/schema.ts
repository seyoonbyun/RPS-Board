import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // 4-digit password
  createdAt: timestamp("created_at").defaultNow(),
});

export const scoreboardData = pgTable("scoreboard_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  region: text("region"),
  userIdField: text("user_id_field"),
  partner: text("partner"),
  memberName: text("member_name"),
  industry: text("industry"), // 산업군 (read-only from Google Sheets)
  company: text("company"), // 회사 (read-only from Google Sheets)
  specialty: text("specialty"),
  targetCustomer: text("target_customer"),
  rpartner1: text("rpartner1"),
  rpartner1Specialty: text("rpartner1_specialty"),
  rpartner1Stage: text("rpartner1_stage"),
  rpartner2: text("rpartner2"),
  rpartner2Specialty: text("rpartner2_specialty"),
  rpartner2Stage: text("rpartner2_stage"),
  rpartner3: text("rpartner3"),
  rpartner3Specialty: text("rpartner3_specialty"),
  rpartner3Stage: text("rpartner3_stage"),
  rpartner4: text("rpartner4"),
  rpartner4Specialty: text("rpartner4_specialty"),
  rpartner4Stage: text("rpartner4_stage"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const changeHistory = pgTable("change_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

export const insertScoreboardSchema = createInsertSchema(scoreboardData).omit({
  id: true,
  userId: true,
  updatedAt: true,
});

export const insertChangeHistorySchema = createInsertSchema(changeHistory).omit({
  id: true,
  timestamp: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertScoreboardData = z.infer<typeof insertScoreboardSchema>;
export type ScoreboardData = typeof scoreboardData.$inferSelect;
export type InsertChangeHistory = z.infer<typeof insertChangeHistorySchema>;
export type ChangeHistory = typeof changeHistory.$inferSelect;

// Validation schemas
export const loginSchema = z.object({
  email: z.string().min(1, "이메일을 입력해주세요").email("올바른 이메일 형식을 입력해주세요"),
  password: z.string().length(4, "비밀번호는 4자리여야 합니다"),
});

export type LoginForm = z.infer<typeof loginSchema>;

export const scoreboardFormSchema = insertScoreboardSchema.extend({
  region: z.string().min(1, "지역을 입력해주세요"),
  userIdField: z.string().optional(), // ID 필드는 선택사항으로 변경
  memberName: z.string().min(1, "멤버명을 입력해주세요"),
  industry: z.string().optional(), // 산업군 (read-only from Google Sheets)
  company: z.string().optional(), // 회사 (read-only from Google Sheets)
  specialty: z.string().optional(), // 전문분야 (bidirectional sync)
  targetCustomer: z.string().optional(), // 핵심 고객층 (bidirectional sync)
});

// Partial update schema for scoreboard data - allows updating individual fields
export const scoreboardPartialUpdateSchema = z.object({
  region: z.string().optional(),
  partner: z.string().optional(),
  userIdField: z.string().optional(),
  memberName: z.string().optional(),
  industry: z.string().optional(),
  company: z.string().optional(),
  specialty: z.string().optional(),
  targetCustomer: z.string().optional(),
  rpartner1: z.string().optional(),
  rpartner1Specialty: z.string().optional(),
  rpartner1Stage: z.string().optional(),
  rpartner2: z.string().optional(),
  rpartner2Specialty: z.string().optional(),
  rpartner2Stage: z.string().optional(),
  rpartner3: z.string().optional(),
  rpartner3Specialty: z.string().optional(),
  rpartner3Stage: z.string().optional(),
  rpartner4: z.string().optional(),
  rpartner4Specialty: z.string().optional(),
  rpartner4Stage: z.string().optional(),
});

export type ScoreboardForm = z.infer<typeof scoreboardFormSchema>;
