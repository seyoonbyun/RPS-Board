import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage.js";
import { loginSchema, scoreboardFormSchema, scoreboardPartialUpdateSchema, type InsertScoreboardData } from "./schema.js";
import { z } from "zod";
import { getGoogleSheetsService } from "./google-sheets.js";
import { PartnerRecommendationEngine } from './partner-recommendation.js';
import { ObjectStorageService } from "./objectStorage.js";
import * as iconv from 'iconv-lite';
import { enqueuePendingSync, processPendingSyncs } from './sheet-sync-queue.js';
import { BUSINESS_CONFIG, FILE_CONFIG, DEFAULT_VALUES } from './constants.js';
import { httpErrorOf } from './errors.js';
import { recordLoginFailure, loginFailureSummary } from './login-log.js';
import { pool } from './db.js';

// Multer 설정 - 메모리에 파일 저장
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_CONFIG.MAX_FILE_SIZE_5MB,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('CSV 파일만 업로드 가능합니다.'));
    }
  }
});

// 로그인 rate limiter: IP당 10초 윈도우에 5회 제한 (서버리스 인스턴스별 카운트; 완벽하진 않아도 급증 방어)
const LOGIN_RATE_WINDOW_MS = 10_000;
const LOGIN_RATE_MAX = 5;
const loginAttempts = new Map<string, number[]>();

/** 프록시(Vercel) 뒤의 실제 클라이언트 IP. 로그인 로그와 rate limit 이 같은 값을 쓴다. */
function clientIp(req: any): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function loginRateLimit(req: any, res: any, next: any) {
  const ip = clientIp(req);
  const now = Date.now();
  const cutoff = now - LOGIN_RATE_WINDOW_MS;
  const history = (loginAttempts.get(ip) || []).filter((t: number) => t > cutoff);
  if (history.length >= LOGIN_RATE_MAX) {
    // 같은 사무실(공유 IP)에서 여러 명이 동시에 로그인하면 여기 걸린다 — 사유를 남겨야 보인다.
    recordLoginFailure(req.body?.email, 'RATE_LIMITED', ip).catch(() => {});
    return res.status(429).json({
      code: 'RATE_LIMITED',
      message: '잠시 후 다시 시도해주세요. (같은 장소에서 여러 명이 동시에 로그인하면 잠깐 제한됩니다)',
    });
  }
  history.push(now);
  loginAttempts.set(ip, history);
  // 간이 GC: 맵이 커지면 오래된 항목 정리
  if (loginAttempts.size > 5000) {
    Array.from(loginAttempts.entries()).forEach(([k, v]) => {
      const pruned = v.filter((t: number) => t > cutoff);
      if (pruned.length === 0) loginAttempts.delete(k);
      else loginAttempts.set(k, pruned);
    });
  }
  next();
}

// requireAdmin: /api/admin/* 엔드포인트에 대한 호출자 권한 검증 미들웨어
// 호출자 이메일은 x-caller-email 헤더 또는 req.body.adminEmail로 식별
// check-permission, board 조회 등 일부 read-only 엔드포인트는 화이트리스트로 제외
// app.use('/api/admin', ...)로 마운트되므로 req.path는 mount 이후 부분 (예: '/check-permission')
const ADMIN_AUTH_BYPASS = new Set([
  '/check-permission',  // 자기 자신의 권한 확인용 (인증 전 호출됨)
]);

async function requireAdmin(req: any, res: any, next: any) {
  if (ADMIN_AUTH_BYPASS.has(req.path)) return next();

  const callerEmail =
    (req.headers['x-caller-email'] as string | undefined)?.trim().toLowerCase() ||
    (req.body?.adminEmail as string | undefined)?.trim().toLowerCase() ||
    (req.query?.adminEmail as string | undefined)?.trim().toLowerCase() ||
    '';

  if (!callerEmail) {
    return res.status(401).json({ message: '호출자 식별 정보가 없습니다 (x-caller-email 헤더 필요)' });
  }

  try {
    const sheetsService = getGoogleSheetsService();
    if (!sheetsService) {
      return res.status(500).json({ message: '권한 검증 서비스 초기화 실패' });
    }
    const isAdmin = await sheetsService.checkAdminPermission(callerEmail);
    if (!isAdmin) {
      console.warn(`🚫 Non-admin access blocked: ${callerEmail} → ${req.method} ${req.path}`);
      return res.status(403).json({ message: '관리자 권한이 필요합니다' });
    }
    (req as any).adminEmail = callerEmail;
    next();
  } catch (err) {
    // 시트를 못 읽은 것을 '권한 없음'으로 답하지 않는다 — 관리자가 튕기는 원인이었다.
    const mapped = httpErrorOf(err);
    console.error(`requireAdmin middleware error [${mapped.code}]:`, err);
    res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // 매 요청마다 pending sheet sync 큐를 비동기 처리 (응답을 블로킹하지 않음)
  app.use((req, res, next) => {
    processPendingSyncs().catch(err => console.error('Background sync processing error:', err));
    next();
  });

  // 모든 /api/admin/* 엔드포인트에 권한 미들웨어 적용 (라우트 등록 전에 마운트 필수)
  app.use('/api/admin', requireAdmin);

  // Health check endpoint for deployment
  app.get("/health", (req, res) => {
    res.status(200).json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      service: "RPS System"
    });
  });

  // API status endpoint (includes pending sync count for monitoring)
  app.get("/api/status", async (req, res) => {
    let pendingSyncCount = 0;
    try {
      const { db: dbInstance } = await import('./db.js');
      const { pendingSheetSyncs: pss } = await import('./schema.js');
      if (dbInstance) {
        const { sql: sqlFn } = await import('drizzle-orm');
        const [row] = await dbInstance.select({ count: sqlFn`count(*)::int` }).from(pss);
        pendingSyncCount = (row as any)?.count ?? 0;
      }
    } catch {}
    res.status(200).json({
      status: "ok",
      message: "BNI Korea RPS System API",
      timestamp: new Date().toISOString(),
      pendingSyncCount,
    });
  });

  // Authentication routes
  app.post("/api/auth/login", loginRateLimit, async (req, res) => {
    const ip = clientIp(req);
    let email: string | undefined;
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        await recordLoginFailure(req.body?.email, 'INVALID_INPUT', ip);
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: "이메일 형식과 4자리 비밀번호를 확인해주세요.",
        });
      }
      email = parsed.data.email;
      const password = parsed.data.password;

      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        await recordLoginFailure(email, 'SHEET_UNAVAILABLE', ip);
        return res.status(503).json({
          code: 'SHEET_UNAVAILABLE',
          message: "지금 회원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
        });
      }

      // RPS 시트가 로그인 인증의 유일한 원천 (Auth 시트는 참조하지 않음 — 관리자 추가/삭제 audit log 전용)
      // 조회 실패(SheetUnavailableError)는 여기서 잡지 않고 아래 바깥 catch 가 503 으로 답한다.
      const outcome = await googleSheetsService.authenticate(email, password);
      if (!outcome.ok) {
        await recordLoginFailure(email, outcome.reason === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'NOT_REGISTERED', ip);
        if (outcome.reason === 'BAD_PASSWORD') {
          return res.status(403).json({
            code: 'BAD_PASSWORD',
            message: "비밀번호(4자리)가 일치하지 않습니다. 다시 확인해주세요.",
          });
        }
        return res.status(403).json({
          code: 'NOT_REGISTERED',
          message: "등록된 회원 정보를 찾지 못했습니다. 담당 오피스로 문의해주세요.",
        });
      }

      const { user, isFirst: isFirstLogin } = await storage.upsertUserByEmail({ email, password });
      const userAuth = outcome.auth || 'Member';

      // 활동 로그는 로그인 성공 여부에 영향을 주지 않도록 분리
      try {
        await googleSheetsService.logActivity(email, isFirstLogin ? '첫 로그인' : '로그인', `권한: ${userAuth}`);
      } catch (logError) {
        console.error('Activity log failed (login still succeeds):', logError);
      }

      res.json({ user: { id: user.id, email: user.email, auth: userAuth } });
    } catch (error) {
      const mapped = httpErrorOf(error);
      console.error(`Login error [${mapped.code}]:`, error);
      await recordLoginFailure(email, mapped.code as any, ip);
      res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
    }
  });

  /**
   * 로그인 실패 현황. 예전에는 회원이 카톡으로 알려주기 전까지 아무도 몰랐다.
   * 사유별 건수를 보면 "시트 장애"인지 "PW 오타"인지 즉시 갈린다.
   */
  app.get("/api/admin/login-failures", async (req, res) => {
    try {
      const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 720);
      res.set({ 'Cache-Control': 'no-store' });
      res.json(await loginFailureSummary(hours));
    } catch (error) {
      const mapped = httpErrorOf(error);
      console.error('login-failures error:', error);
      res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
    }
  });

  /**
   * DB 상태 점검. 관리자 인증(시트 기준)만 통과하면 **실제 오류 문자열**을 그대로 준다.
   * 서버리스라 로그를 볼 수 없어서, 원인을 추정하지 않고 직접 읽기 위한 창구다.
   */
  app.get("/api/admin/db-check", async (req, res) => {
    // 호스트만 노출한다(사용자명·비밀번호·DB명은 절대 싣지 않는다).
    // Neon 은 호스트에 endpoint id(ep-...) 가 들어 있어 이것만으로 어느 컴퓨트인지 특정된다.
    let host: string | null = null;
    try {
      host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : null;
    } catch {
      host = 'unparsable';
    }
    const out: any = {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      poolPresent: Boolean(pool),
      host,
      endpointId: host && host.startsWith('ep-') ? host.split('.')[0] : null,
    };
    const started = Date.now();
    try {
      if (!pool) throw new Error('pool is null (DATABASE_URL 미설정)');
      const r = await pool.query('SELECT 1 AS ok');
      out.select1 = r.rows?.[0]?.ok ?? null;
      out.ok = true;
    } catch (err: any) {
      out.ok = false;
      out.errorName = err?.name || null;
      out.errorMessage = err?.message || String(err);
      out.errorCode = err?.code || null;
    }
    out.elapsedMs = Date.now() - started;
    res.set({ 'Cache-Control': 'no-store' });
    res.json(out);
  });

  // Admin 시트에 관리자 추가 API
  app.post('/api/admin/add-admin', async (req, res) => {
    try {
      const { region, memberName, email, password } = req.body;

      if (!region || !memberName || !email || !password) {
        return res.status(400).json({ message: '지역명, 담당자명, 이메일, 비밀번호는 필수 입력 사항입니다' });
      }

      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: 'Google Sheets 서비스가 초기화되지 않았습니다' });
      }

      // Auth + RPS 원자적 동기화 (실패 시 Auth 자동 롤백)
      const result = await googleSheetsService.syncAdminEntry({ email, region, memberName, password });
      await googleSheetsService.logAdminActivity(
        req.body.adminEmail || 'admin',
        '관리자 추가',
        `${memberName} (${email}), 권한: Admin, 지역: ${region} [RPS ${result.created ? 'created' : 'updated'}]`
      );
      res.json({ success: true, message: `${email} 관리자가 등록되었습니다 (RPS + Auth 시트 반영)` });
    } catch (error: any) {
      console.error('Add admin error:', error);
      res.status(500).json({ message: error.message || '관리자 등록에 실패했습니다' });
    }
  });

  // 구글 시트 특정 행 데이터 확인 API
  app.post('/api/admin/check-row', async (req, res) => {
    try {
      const { rowNumber } = req.body;
      
      // 전체 사용자 데이터를 가져와서 특정 행 찾기
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: 'Google Sheets service not initialized' });
      }
      const allUsers = await googleSheetsService.getAllUsers();
      
      // 행 번호는 헤더를 제외하고 시작하므로 rowNumber - 2로 계산
      const userIndex = rowNumber - 2;
      const userData = allUsers[userIndex];
      
      if (!userData) {
        return res.json({ rowData: null, message: `Row ${rowNumber} is empty or not found` });
      }
      
      res.json({ 
        rowNumber, 
        userData: userData,
        userIndex: userIndex,
        totalUsers: allUsers.length
      });
    } catch (error) {
      console.error('Check row error:', error);
      res.status(500).json({ message: 'Failed to check row data' });
    }
  });

  // 🔥 ALPHA 챕터 사용자 디버깅 전용 엔드포인트
  app.get('/api/debug/user/:email', async (req, res) => {
    try {
      const { email } = req.params;
      console.log(`🔥 DEBUGGING USER: ${email}`);
      
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ error: 'Google Sheets service not initialized' });
      }
      const allUsers = await googleSheetsService.getAllUsers();
      const targetUser = allUsers.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
      
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      console.log(`🔥 FOUND USER DATA:`, {
        email: targetUser.email,
        chapter: targetUser.chapter,
        totalPartners: targetUser.totalPartners,
        achievement: targetUser.achievement,
        rpartner1: targetUser.rpartner1,
        rpartner1Stage: targetUser.rpartner1Stage,
        rpartner2: targetUser.rpartner2,
        rpartner2Stage: targetUser.rpartner2Stage,
        rpartner3: targetUser.rpartner3,
        rpartner3Stage: targetUser.rpartner3Stage,
        rpartner4: targetUser.rpartner4,
        rpartner4Stage: targetUser.rpartner4Stage
      });
      
      // P 단계 파트너 재계산
      const partners = [
        { name: targetUser.rpartner1, stage: targetUser.rpartner1Stage },
        { name: targetUser.rpartner2, stage: targetUser.rpartner2Stage },
        { name: targetUser.rpartner3, stage: targetUser.rpartner3Stage },
        { name: targetUser.rpartner4, stage: targetUser.rpartner4Stage }
      ];
      
      const profitPartners = partners.filter(p => 
        p.name && p.name.trim() !== '' && p.stage?.includes('Profit')
      ).length;
      
      const calculatedAchievement = Math.round((profitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
      
      console.log(`🔥 RECALCULATED VALUES:`, {
        currentTotalPartners: targetUser.totalPartners,
        currentAchievement: targetUser.achievement,
        calculatedProfitPartners: profitPartners,
        calculatedAchievement: `${calculatedAchievement}%`,
        shouldUpdateU: targetUser.totalPartners !== profitPartners.toString(),
        shouldUpdateV: targetUser.achievement !== `${calculatedAchievement}%`
      });
      
      res.json({
        user: targetUser,
        recalculated: {
          profitPartners,
          achievement: `${calculatedAchievement}%`
        },
        needsUpdate: {
          totalPartners: targetUser.totalPartners !== profitPartners.toString(),
          achievement: targetUser.achievement !== `${calculatedAchievement}%`
        }
      });
      
    } catch (error) {
      console.error('Debug endpoint error:', error);
      res.status(500).json({ error: 'Debug failed' });
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
          // 읽기 전용 필드는 구글 시트 우선, 양방향 필드는 타임스탬프 기반 최신 데이터 우선
          const googleSheetsData = {
            region: profile.region || '',
            userIdField: '',
            partner: profile.chapter || '',
            memberName: profile.memberName || '',
            industry: profile.industry || '', // 읽기 전용: 구글 시트 우선
            company: profile.company || '', // 읽기 전용: 구글 시트 우선
            specialty: profile.specialty || '', // 양방향: 구글 시트에서 최신 값 가져오기
            targetCustomer: profile.targetCustomer || '', // 양방향: 구글 시트에서 최신 값 가져오기
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
            specialty: {
              fromSheets: profile.specialty,
              existing: existingData?.specialty,
              willUpdate: profile.specialty
            },
            targetCustomer: {
              fromSheets: profile.targetCustomer, 
              existing: existingData?.targetCustomer,
              willUpdate: profile.targetCustomer
            },
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

      // 1) 활동 로깅 (구글 시트 동기화 성공 여부와 무관하게 항상 기록)
      const user = await storage.getUserById(userId);
      const sheetsService = getGoogleSheetsService();

      if (user && sheetsService) {
        const partners = [
          { name: savedData.rpartner1, stage: savedData.rpartner1Stage },
          { name: savedData.rpartner2, stage: savedData.rpartner2Stage },
          { name: savedData.rpartner3, stage: savedData.rpartner3Stage },
          { name: savedData.rpartner4, stage: savedData.rpartner4Stage },
        ];
        const profitPartners = partners.filter(p => p.name && p.name.trim() && p.stage?.includes('Profit')).length;
        const achievement = Math.round((profitPartners / BUSINESS_CONFIG.PARTNER_TARGET) * 100);

        const fieldLabels: Record<string, string> = {
          specialty: '전문분야',
          company: '회사명',
          targetCustomer: '핵심 고객층',
          industry: '산업군',
          memberName: '멤버명',
          rpartner1: 'R파트너1',
          rpartner1Specialty: 'R파트너1 전문분야',
          rpartner1Stage: 'R파트너1 단계',
          rpartner2: 'R파트너2',
          rpartner2Specialty: 'R파트너2 전문분야',
          rpartner2Stage: 'R파트너2 단계',
          rpartner3: 'R파트너3',
          rpartner3Specialty: 'R파트너3 전문분야',
          rpartner3Stage: 'R파트너3 단계',
          rpartner4: 'R파트너4',
          rpartner4Specialty: 'R파트너4 전문분야',
          rpartner4Stage: 'R파트너4 단계',
        };

        const logEntries: Array<{ action: string; details: string }> = [
          { action: existingData ? '데이터 수정' : '데이터 입력', details: `달성률: ${achievement}%` }
        ];
        for (const [field, label] of Object.entries(fieldLabels)) {
          const oldVal = (existingData as any)?.[field]?.toString().trim() || '';
          const newVal = (savedData as any)?.[field]?.toString().trim() || '';
          if (oldVal === newVal) continue;

          let action: string;
          let details: string;
          if (!oldVal && newVal) {
            action = field === 'specialty' ? `${label} 최초 입력 (앱 게시)` : `${label} 입력`;
            details = newVal;
          } else if (oldVal && !newVal) {
            action = `${label} 삭제`;
            details = oldVal;
          } else {
            action = `${label} 변경`;
            details = `${oldVal} → ${newVal}`;
          }
          if (field.endsWith('Stage') && newVal) {
            const stageLabel = newVal.includes('Visibility') ? 'V단계' : newVal.includes('Credibility') ? 'C단계' : newVal.includes('Profit') ? 'P단계' : '';
            if (stageLabel) details += ` (${stageLabel})`;
          }
          logEntries.push({ action, details });
        }

        // 모든 로그를 병렬로 await — 서버리스에서 응답 전 완료 보장
        const logResults = await Promise.allSettled(
          logEntries.map(e => sheetsService.logActivity(user.email, e.action, e.details))
        );
        const failed = logResults.filter(r => r.status === 'rejected').length;
        if (failed > 0) console.error(`⚠️ ActivityLog: ${failed}/${logEntries.length} entries failed to write`);

        // 2) 구글 시트 RPS 데이터 동기화 (실패 시 pending 큐에 저장하여 재시도)
        try {
          await sheetsService.syncScoreboardData({ ...savedData, userEmail: user.email });
          console.log(`✅ Synced to Google Sheets for ${user.email} (${profitPartners} profit partners, ${achievement}%)`);
        } catch (syncError) {
          console.error('Google Sheets sync failed, saving to retry queue:', syncError);
          await enqueuePendingSync(
            user.email,
            'syncScoreboard',
            { ...savedData, userEmail: user.email },
            String((syncError as Error)?.message || syncError).substring(0, 500),
          );
        }
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

      const sheetsForLog = getGoogleSheetsService();
      if (sheetsForLog) await sheetsForLog.logActivity(user.email, '시트 동기화', '시트→앱');

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
          try {
            await sheetsService.syncScoreboardData({
              ...data,
              userEmail: user.email
            });
          } catch (syncError) {
            console.error('Google Sheets sync failed, saving to retry queue:', syncError);
            await enqueuePendingSync(
              user.email,
              'syncScoreboard',
              { ...data, userEmail: user.email },
              String((syncError as Error)?.message || syncError).substring(0, 500),
            );
            // DB에는 이미 데이터가 있으므로 유저에게는 성공 응답 + 경고
            return res.json({
              message: "데이터가 저장되었습니다. 구글 시트 동기화는 잠시 후 자동으로 재시도됩니다.",
              timestamp: new Date(),
              pendingSync: true,
            });
          }

          try {
            await sheetsService.logActivity(user.email, '시트 동기화', '앱→시트');
          } catch (logError) {
            console.error('Activity log failed (sync succeeded):', logError);
          }
        }
      }

      res.json({ message: "구글 시트와 동기화가 완료되었습니다", timestamp: new Date() });
    } catch (error) {
      console.error('Error in POST /api/sync:', error);
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

      // 활동 로그 기록 (탈퇴 처리 전에 — 시트에 흔적 남기기)
      try {
        await sheetsService.logActivity(user.email, '계정 탈퇴', `${profile.memberName || ''} (${profile.region || ''}/${profile.chapter || ''})`);
      } catch (e) {
        console.error('ActivityLog write for self-withdrawal failed:', e);
      }

      // Delete user completely from Google Sheets - 행 자체를 삭제
      // 자진 탈퇴이므로 삭제 처리자 = 본인 이메일로 기록
      await sheetsService.markUserAsWithdrawn(user.email, user.email);

      // Delete user data from local database
      await storage.deleteUserData(userId);

      res.json({
        message: "사용자가 완전히 삭제되었습니다",
        deletedUser: {
          region: profile.region,
          chapter: profile.chapter,
          memberName: profile.memberName,
          email: user.email
        }
      });
    } catch (error) {
      console.error('Error in user deletion:', error);
      res.status(500).json({ message: "사용자 삭제 중 오류가 발생했습니다" });
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
      // 캐시 방지 헤더 추가
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      console.log("🔄 Force refreshing user data from Google Sheets...");
      const allUsersData = await storage.getAllUsersFromGoogleSheets();

      // 활성 사용자와 탈퇴 사용자 필터링
      const activeUsers = allUsersData.filter((user: any) => user.status !== '탈퇴');
      const withdrawnUsers = allUsersData.filter((user: any) => user.status === '탈퇴');
      
      console.log(`📊 User summary: ${activeUsers.length} active, ${withdrawnUsers.length} withdrawn`);
      
      res.json(allUsersData); // 모든 사용자 반환 (프론트엔드에서 필터링)
    } catch (error: any) {
      console.error("❌ Error fetching all users:", error);
      res.status(500).json({ message: "사용자 목록 조회 실패" });
    }
  });

  // Admin API: Get chapters from Master sheet
  app.get("/api/admin/chapters", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const chapters = await sheetsService.getChaptersFromMaster();
      res.json(chapters);
    } catch (error: any) {
      console.error("❌ Error fetching chapters:", error);
      res.status(500).json({ message: "챕터 목록 조회 실패" });
    }
  });

  // Admin API: Add new chapter to Master sheet
  app.post("/api/admin/add-chapter", async (req, res) => {
    try {
      const { chapter, region } = req.body;
      if (!chapter || !region) {
        return res.status(400).json({ message: "챕터명과 지역명은 필수 항목입니다" });
      }

      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const existing = await sheetsService.getChaptersFromMaster();
      if (existing.includes(chapter.trim())) {
        return res.status(409).json({ message: `'${chapter}' 챕터가 이미 존재합니다` });
      }

      await sheetsService.addChapterToMaster(chapter.trim(), region.trim());
      sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '신규 챕터 생성', `${chapter} (지역: ${region})`);
      sheetsService.logChapterActivity(req.body.adminEmail || 'admin', '신규 챕터 생성', `챕터: ${chapter}, 지역: ${region}`);
      res.json({ success: true, message: `'${chapter}' 챕터가 등록되었습니다` });
    } catch (error: any) {
      console.error("❌ Error adding chapter:", error);
      res.status(500).json({ message: "챕터 추가 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Delete chapter from Master sheet
  app.delete("/api/admin/delete-chapter", async (req, res) => {
    try {
      const { chapter } = req.body;
      if (!chapter) {
        return res.status(400).json({ message: "챕터명은 필수입니다" });
      }

      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      await sheetsService.deleteChapterFromMaster(chapter.trim());
      sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '챕터 삭제', `${chapter}`);
      sheetsService.logChapterActivity(req.body.adminEmail || 'admin', '챕터 삭제', `챕터: ${chapter}`);
      res.json({ success: true, message: `'${chapter}' 챕터가 삭제되었습니다` });
    } catch (error: any) {
      console.error("❌ Error deleting chapter:", error);
      res.status(500).json({ message: error.message || "챕터 삭제 중 오류가 발생했습니다" });
    }
  });

  // Admin API: List all admins from Admin sheet
  app.get("/api/admin/list-admins", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      const admins = await sheetsService.getAdminList();
      res.json(admins);
    } catch (error: any) {
      console.error("❌ Error listing admins:", error);
      res.status(500).json({ message: "관리자 목록 조회 실패" });
    }
  });

  // Admin API: Delete admin from Admin sheet
  app.delete("/api/admin/delete-admin", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "이메일은 필수입니다" });

      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });

      // Auth 시트에서 audit 행 제거
      await sheetsService.deleteAdminFromSheet(email.trim());
      // RPS 시트에서 해당 행을 통째로 삭제 (A,B,C,D,W,X,Y,Z 포함 전체)
      try {
        await sheetsService.deleteUserRowFromRPS(email.trim());
      } catch (rpsErr: any) {
        console.error('RPS 행 삭제 실패:', rpsErr);
        return res.status(500).json({ message: `Auth 시트에선 제거됐으나 RPS 시트 행 삭제 실패: ${rpsErr.message || rpsErr}` });
      }
      await sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '관리자 삭제', `${email}`);
      res.json({ success: true, message: `'${email}' 관리자가 삭제되었습니다 (RPS 행 삭제 + Auth 시트 제거)` });
    } catch (error: any) {
      console.error("❌ Error deleting admin:", error);
      res.status(500).json({ message: error.message || "관리자 삭제 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Get board posts
  app.get("/api/admin/board", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      const posts = await sheetsService.getBoardPosts();
      res.json(posts);
    } catch (error: any) {
      res.status(500).json({ message: "게시판 조회 실패" });
    }
  });

  // Admin API: Create board post (question/request)
  //
  // 글이 올라오면 **문의자에게 접수 문자 · 나에게 알림 문자**가 나가야 하는데,
  // 솔라피 키가 서버에 없다(로컬 워커만 갖고 있다). 그래서 여기서는 대장에 행만 열고,
  // 문자는 `automation/board_watch.py` 가 3분마다 집어가 보낸다.
  app.post("/api/admin/board", async (req, res) => {
    try {
      const { email, name, role, content, phone } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "내용을 입력해주세요" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });

      // 연락처는 **Auth 시트에만** 저장한다. 게시글 본문에 남기지 않는 이유는,
      // 본문에 남기면 확인 후 지워야 하고 잊으면 전 지역 담당자에게 보이기 때문이다.
      let saved = '';
      if (phone?.trim() && email) {
        saved = (await sheetsService.setContactPhone(email, phone.trim())) ? phone.trim() : '';
      }

      const rowNo = await sheetsService.addBoardPost(email, name, role, '요청', content.trim());
      // ⚠ **내셔널이 쓰는 `요청` 은 문의가 아니라 공지다.** 게시 완료 결과 글을
      //    `automation/publish_watch.py` 가 이 API 로 올리는데, 그때도 대장에 행을
      //    열면 아무도 닫지 않는 `접수` 행이 영영 남는다(2026-08-24 `게시판 #7`).
      //    `board_watch.py` 도 같은 기준으로 이 글을 문의에서 제외한다.
      if (rowNo > 0 && role !== 'National') {
        await sheetsService.openProcessRow({
          flow: '게시판',
          key: `게시판 #${rowNo}`,
          owner: name || email,
          email,
          phone: saved || await sheetsService.getContactPhone(email),
          body: content.trim(),
          status: '접수',
        });
      }
      sheetsService.logAdminActivity(email, '게시판 글 작성', content.trim().substring(0, 50));
      res.json({ success: true, message: "등록되었습니다 — 확인 후 안내드리겠습니다" });
    } catch (error: any) {
      res.status(500).json({ message: "게시글 등록 실패" });
    }
  });

  // Admin API: Reply to board post (master only)
  app.post("/api/admin/board/reply", async (req, res) => {
    try {
      const { email, name, role, content, parentIndex } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "내용을 입력해주세요" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      await sheetsService.addBoardPost(email, name, role, '답변', content.trim(), String(parentIndex));
      sheetsService.logAdminActivity(email, '게시판 답변', content.trim().substring(0, 50));
      res.json({ success: true, message: "답변이 등록되었습니다" });
    } catch (error: any) {
      res.status(500).json({ message: "답변 등록 실패" });
    }
  });

  // Admin API: Delete board post
  app.post("/api/admin/board/delete", async (req, res) => {
    try {
      const { rowIndex } = req.body;
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "초기화 실패" });
      await sheetsService.deleteBoardPost(rowIndex);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: "삭제 실패" }); }
  });

  // Admin API: Update board post
  app.post("/api/admin/board/update", async (req, res) => {
    try {
      const { rowIndex, content } = req.body;
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "초기화 실패" });
      await sheetsService.updateBoardPost(rowIndex, content);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: "수정 실패" }); }
  });

  // Admin API: Restore single member from WithdrawalHistory to RPS
  app.post("/api/admin/restore-member", async (req, res) => {
    try {
      const { email, region, chapter, memberName } = req.body;
      if (!email) return res.status(400).json({ message: "이메일은 필수입니다" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      await sheetsService.restoreMemberFromHistory(email, region, chapter, memberName);
      sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '멤버 복원', `${memberName} (${email})`);
      res.json({ success: true, message: `${memberName} 멤버가 복원되었습니다` });
    } catch (error: any) {
      console.error("❌ Error restoring member:", error);
      res.status(500).json({ message: error.message || "복원 중 오류" });
    }
  });

  // Admin API: Get master notices from MasterLog sheet
  app.get("/api/admin/master-notices", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "초기화 실패" });
      const notices = await sheetsService.getMasterNotices();
      res.json(notices);
    } catch (error: any) {
      res.status(500).json({ message: "공지 조회 실패" });
    }
  });

  // Admin API: Get regions from Master sheet
  app.get("/api/admin/regions", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const regions = await sheetsService.getRegionsFromMaster();
      res.json(regions);
    } catch (error: any) {
      console.error("❌ Error fetching regions:", error);
      res.status(500).json({ message: "지역 목록 조회 실패" });
    }
  });

  // Admin API: Delete region from Master sheet
  app.delete("/api/admin/delete-region", async (req, res) => {
    try {
      const { region } = req.body;
      if (!region) return res.status(400).json({ message: "지역명은 필수입니다" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      await sheetsService.deleteRegionFromMaster(region.trim());
      res.json({ success: true, message: `'${region}' 지역이 삭제되었습니다` });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "지역 삭제 중 오류" });
    }
  });

  // Admin API: Add region to Master sheet
  //
  // 모 시트에 한 줄 넣는 것으로 끝나지 않는다. 지역 하나가 실제로 쓰이려면
  // RPS 시트 · RPI 집계 행 · QR · 지역 로고 · imweb ALL/지역 페이지가 다 있어야 하는데,
  // 그것들은 예전엔 **신규 챕터가 런칭할 때만** 곁다리로 만들어졌다(안양이 넉 달간 빠진 이유).
  //
  // imweb 쓰기는 사람이 로그인해 둔 브라우저 프로필로만 되므로 서버리스에서 못 한다.
  // → 여기서는 **접수만** 하고(대장 `rps new account` 에 행을 연다),
  //   로컬 워커 `automation/region_watch.py` 가 3분마다 집어가 생성한다.
  app.post("/api/admin/add-region", async (req, res) => {
    try {
      const { region, regionEng, regionKor, ownerPhone, ownerName, adminEmail } = req.body;
      if (!region) return res.status(400).json({ message: "지역명은 필수입니다" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });

      const label = region.trim();
      const existing = await sheetsService.getRegionsFromMaster();
      if (existing.includes(label)) return res.status(409).json({ message: `'${label}' 지역이 이미 존재합니다` });

      // `Seoul Central 센트럴` 처럼 영문에 공백이 있을 수 있다 → 한글 부분을 뒤에서 떼어낸다.
      const m = label.match(/^(.*?)\s*([가-힣][가-힣0-9]*)$/);
      const eng = (regionEng || m?.[1] || '').trim();
      const kor = (regionKor || m?.[2] || '').trim();
      if (!eng || !/^[A-Za-z][A-Za-z0-9 ]*$/.test(eng)) {
        return res.status(400).json({
          message: `지역 영문명을 확정하지 못했습니다 (받은 값: '${eng}'). 영문명을 직접 입력해 주세요` });
      }
      if (!kor) {
        return res.status(400).json({ message: "지역 한글명(imweb 페이지 표기)이 필요합니다" });
      }

      await sheetsService.addRegionToMaster(label);

      // 지역 페이지 비밀번호 = **랜덤 4자리**(챕터는 런칭일 MMDD 지만 지역은 규칙이 없다).
      // ⛔ imweb 은 비번을 bcrypt 로 저장해 되읽을 수 없다 → 여기서 정해 대장에 남긴다.
      const pw = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const key = `지역 ${label}`;
      const actor = adminEmail || 'admin';
      let phone = (ownerPhone || '').replace(/\D/g, '');
      if (!phone && adminEmail) phone = await sheetsService.getContactPhone(adminEmail);

      // 입구(`신청 접수`) 와 처리 대장(`rps new account`) 둘 다 연다.
      // 입구 = 무엇을 요청했나 · 대장 = 어디까지 됐고 문자가 나갔나.
      const intakeRow = await sheetsService.addIntakeRow({
        kind: '지역',
        regionKor: label, regionEng: eng,
        owner: ownerName || actor, email: actor, phone,
        active: true,
        note: `pw=${pw}`,
      });
      const rowNo = await sheetsService.openProcessRow({
        flow: '지역등록',
        key,
        owner: ownerName || actor,
        email: actor,
        phone,
        body: `imweb=${kor} | url=${eng} | pw=${pw}`,
        status: '접수',
      });
      console.log(`📥 지역 접수: 신청 ${intakeRow}행 / 대장 ${rowNo}행`);

      sheetsService.logAdminActivity(actor, '신규 지역 등록', `${label} (imweb: ${kor} /${eng})`);
      sheetsService.logChapterActivity(actor, '신규 지역 등록', `지역: ${label}`);

      res.json({
        success: true,
        message: `'${label}' 지역이 등록되었습니다 — 시트·QR·페이지 생성이 접수되었습니다`,
        queued: rowNo > 0,
        detail: rowNo > 0
          ? "생성 진행 상황은 문자로 안내되며, 페이지는 확인 후 게시됩니다."
          : "⚠ 목록에는 추가됐지만 생성 접수에 실패했습니다. 담당자에게 알려주세요.",
      });
    } catch (error: any) {
      console.error("❌ Error adding region:", error);
      res.status(500).json({ message: "지역 추가 중 오류" });
    }
  });

  // Admin API: 신규 챕터 런칭 신청 (네이티브 폼 → `신청 접수` 시트)
  //
  // 2026-08-23 Airtable 임베드 폼을 걷어냈다. iframe 이 어드민 로딩을 끌었고,
  // 로그인한 담당자 정보를 못 채워 매번 손으로 적어야 했다.
  // ⚠ 챕터 영문명은 담당자가 BNI Connect 를 보고 적는다. 오기가 시트명·QR 슬러그·
  //   페이지 url 에 전부 번지므로, 파이프라인이 추출 파일과 한 번 더 대조한다.
  app.post("/api/admin/launch-request", async (req, res) => {
    try {
      const { region, chapter, chapterEng, launch, owner, email, phone, connectOk, note } = req.body;
      if (!region?.trim() || !chapter?.trim()) {
        return res.status(400).json({ message: "지역과 챕터명은 필수입니다" });
      }
      // 영문명 오기는 시트명·QR 슬러그·페이지 주소에 전부 번지고 되돌리기 어렵다.
      // 파이프라인이 BNI Connect 추출과 한 번 더 대조한다(automation/pipeline.py).
      const eng = (chapterEng || '').trim();
      if (!eng || !/^[A-Za-z0-9][A-Za-z0-9 .&'-]*$/.test(eng)) {
        return res.status(400).json({ message: "챕터 영문명을 BNI Connect 표기 그대로 입력해 주세요 (예: Signia)" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test((launch || '').trim())) {
        // 런칭일이 없으면 챕터 시트·페이지 비밀번호(MMDD)를 정할 수 없다.
        return res.status(400).json({ message: "런칭 예정일을 YYYY-MM-DD 로 입력해 주세요" });
      }
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });

      let contact = (phone || '').trim();
      if (contact) await sheetsService.setContactPhone(email, contact, owner);
      if (!contact && email) contact = await sheetsService.getContactPhone(email);

      const rowNo = await sheetsService.addIntakeRow({
        kind: '챕터',
        regionKor: region.trim(),
        chapterKor: chapter.trim(),
        chapterEng: eng,
        launch: launch.trim(),
        owner: owner || email || '',
        email: email || '',
        phone: contact,
        connectOk: !!connectOk,
        // 담당자가 낸 신청은 곧 런칭 확정 건이다. 확정 전이면 접수하지 않는 게 맞다 —
        // imweb 은 삭제 API 가 없어 잘못 만든 페이지를 되돌릴 수 없다.
        active: true,
        note: (note || '').trim(),
      });
      if (!rowNo) return res.status(500).json({ message: "접수 기록에 실패했습니다" });

      sheetsService.logAdminActivity(email || 'admin', '챕터 런칭 신청',
        `${region.trim()} ${chapter.trim()} · 런칭 ${launch.trim()}`);
      res.json({
        success: true,
        message: `'${chapter.trim()}' 챕터 런칭 신청이 접수되었습니다`,
        detail: contact
          ? "처리 결과는 문자(LMS)로 안내드립니다. 페이지는 확인 후 게시됩니다."
          : "⚠ 연락처가 없어 문자 안내를 받지 못합니다. 연락처를 남겨 주세요.",
        row: rowNo,
      });
    } catch (error: any) {
      console.error("❌ Error creating launch request:", error);
      res.status(500).json({ message: "런칭 신청 중 오류가 발생했습니다" });
    }
  });

  // Admin API: 신청 접수 현황 (지역·챕터 공통)
  app.get("/api/admin/intake", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      res.json(await sheetsService.getIntakeRows(50));
    } catch (error: any) {
      res.status(500).json({ message: "접수 현황 조회 실패" });
    }
  });

  // Admin API: 내 연락처 조회 (게시판 문의 접수 문자용)
  app.get("/api/admin/my-phone", async (req, res) => {
    try {
      const email = (req.query.email || '').toString().trim();
      if (!email) return res.status(400).json({ message: "이메일이 필요합니다" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      res.json({ phone: await sheetsService.getContactPhone(email) });
    } catch (error: any) {
      res.status(500).json({ message: "연락처 조회 실패" });
    }
  });

  // Admin API: 내 연락처 저장 (Auth 시트 F열. 게시글 본문에는 남기지 않는다)
  app.post("/api/admin/my-phone", async (req, res) => {
    try {
      const { email, phone } = req.body;
      if (!email || !phone) return res.status(400).json({ message: "이메일과 연락처가 필요합니다" });
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      const ok = await sheetsService.setContactPhone(email, phone);
      if (!ok) return res.status(400).json({ message: "저장 실패 — 휴대폰 번호 형식(01012345678)을 확인해 주세요" });
      res.json({ success: true, message: "연락처가 저장되었습니다" });
    } catch (error: any) {
      res.status(500).json({ message: "연락처 저장 실패" });
    }
  });

  // Admin API: Initialize Master sheet with regions and chapters
  app.post("/api/admin/initialize-master", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const { regions, chapters } = req.body;

      if (!Array.isArray(regions) || !Array.isArray(chapters)) {
        return res.status(400).json({ message: "지역과 챕터 배열이 필요합니다" });
      }

      const success = await sheetsService.initializeMasterSheet(regions, chapters);
      
      if (success) {
        res.json({ message: "Master 시트가 성공적으로 초기화되었습니다", regions: regions.length, chapters: chapters.length });
      } else {
        res.status(500).json({ message: "Master 시트 초기화 실패" });
      }
    } catch (error: any) {
      console.error("❌ Error initializing master sheet:", error);
      res.status(500).json({ message: "Master 시트 초기화 실패" });
    }
  });

  // 탈퇴 히스토리 조회 API - Google Sheets 실시간 동기화
  app.get("/api/admin/withdrawal-history", async (req, res) => {
    try {
      // 캐시 방지 헤더 설정
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      const history = await googleSheetsService.getWithdrawalHistory();
      console.log(`📋 WithdrawalHistory 조회 완료: ${history.length}개 항목`);
      res.json(history);
    } catch (error) {
      console.error("Get withdrawal history error:", error);
      res.status(500).json({ message: "탈퇴 히스토리 조회 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Bulk withdrawal (최적화됨 - 단일 batchUpdate로 여러 사용자 삭제)
  app.post("/api/admin/bulk-withdrawal", async (req, res) => {
    try {
      const { userEmails, adminEmail } = req.body;

      if (!userEmails || !Array.isArray(userEmails) || userEmails.length === 0) {
        return res.status(400).json({ message: "유효한 이메일 목록을 제공해주세요" });
      }

      console.log(`🔄 Starting optimized bulk withdrawal for ${userEmails.length} users by admin: ${adminEmail || 'unknown'}`, userEmails);

      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }

      // 최적화된 일괄 삭제 메서드 사용 (단일 API 호출로 여러 행 삭제)
      const result = await sheetsService.bulkMarkUsersAsWithdrawn(userEmails, adminEmail);
      
      // 로컬 데이터베이스에서도 사용자 데이터 삭제
      for (const email of userEmails) {
        try {
          const localUser = await storage.getUserByEmail(email);
          if (localUser) {
            await storage.deleteUserData(localUser.id);
          }
        } catch (localError) {
          console.error(`⚠️ Local user data deletion failed for ${email}:`, localError);
        }
      }

      const responseMessage = `${result.processedCount}명 탈퇴 처리 완료`;
      const response: any = { 
        message: responseMessage,
        processedCount: result.processedCount,
        totalRequested: userEmails.length
      };

      if (result.errors.length > 0) {
        response.errors = result.errors;
        response.message += ` (${result.errors.length}건 실패)`;
      }

      console.log(`✅ Bulk withdrawal completed: ${result.processedCount}/${userEmails.length}`);
      const svcW = getGoogleSheetsService();
      if (svcW) svcW.logAdminActivity(req.body.adminEmail || 'admin', '유저 계정 삭제 (탈퇴)', `${result.processedCount}명: ${userEmails.join(', ')}`);
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
        password: password || DEFAULT_VALUES.PASSWORD, // 기본 비밀번호
        auth: auth || 'Member' // 기본 권한
      });
      
      console.log(`✅ New user added successfully: ${email}`);
      sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '신규 유저 추가', `${memberName} (${email}), 챕터: ${chapter || '-'}, 지역: ${region || '-'}`);
      res.json({ message: "멤버가 성공적으로 추가되었습니다", email });
      
    } catch (error: any) {
      console.error(`❌ Error adding user:`, error);
      if (error.message.includes('already exists')) {
        res.status(409).json({ message: "이미 존재하는 멤버입니다" });
      } else {
        res.status(500).json({ message: "멤버 추가 중 오류가 발생했습니다" });
      }
    }
  });

  // Admin API: Bulk add users
  app.post("/api/admin/bulk-add-users", async (req, res) => {
    try {
      const { users } = req.body;
      
      if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ message: "유효한 멤버 목록을 제공해주세요" });
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
            password: user.password || DEFAULT_VALUES.PASSWORD,
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
            password: user.password || DEFAULT_VALUES.PASSWORD,
            auth: user.auth || 'Member'
          });

          processedCount++;
          console.log(`✅ Bulk addition completed for ${user.email}`);
        } catch (error: any) {
          console.error(`❌ Bulk addition error for ${user.email}:`, error);
          if (error.message.includes('already exists')) {
            errors.push(`${user.email}: 이미 존재하는 멤버입니다`);
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
      if (sheetsService) sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '대량 유저 추가', `${processedCount}/${users.length}명 추가 완료`);
      res.json(response);
    } catch (error: any) {
      console.error("❌ Error in bulk user addition:", error);
      res.status(500).json({ message: "일괄 멤버 추가 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Update user info
  app.put("/api/admin/update-user", async (req, res) => {
    try {
      const { email, region, chapter, memberName, industry, company, password } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "이메일은 필수 항목입니다" });
      }

      console.log(`🔄 Updating user info: ${email}`);
      
      const sheetsService = getGoogleSheetsService();
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }
      
      const updates: any = {};
      if (region !== undefined) updates.region = region;
      if (chapter !== undefined) updates.chapter = chapter;
      if (memberName !== undefined) updates.memberName = memberName;
      if (industry !== undefined) updates.industry = industry;
      if (company !== undefined) updates.company = company;
      if (password !== undefined && password !== '') updates.password = password;

      const result = await sheetsService.updateUserInfo(email, updates);
      
      if (result.success) {
        const changedFields = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
        sheetsService.logAdminActivity(req.body.adminEmail || 'admin', '유저 정보 수정', `${email} → ${changedFields}`);
        console.log(`✅ User ${email} info updated successfully`);
        res.json({ message: result.message || "정보가 성공적으로 수정되었습니다" });
      } else {
        console.error(`❌ Failed to update user ${email}:`, result.message);
        res.status(400).json({ message: result.message || "정보 수정에 실패했습니다" });
      }
    } catch (error: any) {
      console.error("❌ Error updating user info:", error);
      res.status(500).json({ message: "정보 수정 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Fix user password manually
  app.put("/api/admin/fix-user-password", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "이메일과 비밀번호가 필요합니다" });
      }
      
      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }
      
      // PW 필드만 업데이트 (X열, index 23)
      const accessToken = await googleSheetsService.getAccessTokenPublic();
      
      // 사용자 행 찾기
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetsService.getSpreadsheetId()}/values/RPS!A1:Z5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 사용자 행 검색
      let userRowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i][0] && 
            rows[i][0].toString().trim().toLowerCase() === email.toLowerCase()) {
          userRowIndex = i;
          break;
        }
      }
      
      if (userRowIndex === -1) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }
      
      // PW 컬럼만 업데이트 (X열, index 23)
      const range = `RPS!X${userRowIndex + 1}`;
      const updateResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetsService.getSpreadsheetId()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [[password]]
          })
        }
      );

      if (!updateResponse.ok) {
        throw new Error('PW 업데이트 실패');
      }
      
      const svcLog = getGoogleSheetsService();
      if (svcLog) svcLog.logAdminActivity(req.body.adminEmail || 'admin', '비밀번호 수정', `${email}`);
      res.json({ message: `${email} 사용자의 비밀번호가 ${password}로 수정되었습니다` });

    } catch (error: any) {
      console.error("❌ Error fixing user password:", error);
      res.status(500).json({ message: "비밀번호 수정 중 오류가 발생했습니다" });
    }
  });

  // Admin API: Fix user auth manually
  app.put("/api/admin/fix-user-auth", async (req, res) => {
    try {
      const { email, auth } = req.body;
      
      if (!email || !auth) {
        return res.status(400).json({ message: "이메일과 권한이 필요합니다" });
      }
      
      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }
      
      // AUTH 필드만 업데이트 (Z열, index 25)
      const accessToken = await googleSheetsService.getAccessTokenPublic();
      
      // 사용자 행 찾기
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetsService.getSpreadsheetId()}/values/RPS!A1:Z5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 사용자 행 검색
      let userRowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i][0] && 
            rows[i][0].toString().trim().toLowerCase() === email.toLowerCase()) {
          userRowIndex = i;
          break;
        }
      }
      
      if (userRowIndex === -1) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }
      
      // AUTH 컬럼만 업데이트 (Z열, index 25)
      const range = `RPS!Z${userRowIndex + 1}`;
      const updateResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetsService.getSpreadsheetId()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [[auth]]
          })
        }
      );

      if (!updateResponse.ok) {
        throw new Error('AUTH 업데이트 실패');
      }
      
      const svcLog2 = getGoogleSheetsService();
      if (svcLog2) svcLog2.logAdminActivity(req.body.adminEmail || 'admin', '권한 수정', `${email} → ${auth}`);
      res.json({ message: `${email} 사용자의 권한이 ${auth}로 수정되었습니다` });
      
    } catch (error: any) {
      console.error("❌ Error fixing user auth:", error);
      res.status(500).json({ message: "권한 수정 중 오류가 발생했습니다" });
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
        if (!keyword) return null;
        const lower = keyword.toLowerCase().trim();
        
        // Admin 매핑: ADMIN, admin, 어드민
        if (lower === 'admin' || lower === 'ADMIN'.toLowerCase() || lower === '어드민') {
          return 'Admin';
        }
        
        // Growth 매핑: GROWTH, growth, 그로스, 그로쓰, 성장팀, 성장, 성장 코디네이터, 성장코디네이터, 성장코디
        const growthKeywords = [
          'growth', 'GROWTH'.toLowerCase(),
          '그로스', '그로쓰', '성장팀', '성장',
          '성장 코디네이터', '성장코디네이터', '성장코디'
        ];
        if (growthKeywords.includes(lower)) {
          return 'Growth';
        }
        
        // Member 매핑: MEMBER, member, 멤버
        if (lower === 'member' || lower === 'MEMBER'.toLowerCase() || lower === '멤버') {
          return 'Member';
        }
        
        // 인식되지 않은 키워드는 기본값 Member로 설정하고 로그 남김
        console.log(`⚠️ Unknown auth keyword: "${keyword}", defaulting to Member`);
        return 'Member';
      };

      const users = dataLines.filter(line => {
        // 빈 행이나 모든 필드가 빈 행 필터링
        const parts = line.split(',').map(part => part.trim());
        return parts.length > 0 && parts.some(part => part.length > 0);
      }).map((line, index) => {
        console.log(`🔍 Parsing line ${index + 1}: "${line}"`);
        const parts = line.split(',').map(part => part.trim());
        console.log(`📝 Parts array (length: ${parts.length}):`, parts);
        
        // CSV 필드 구조 (정확한 순서):
        // 1. 이메일, 2. 지역, 3. 챕터, 4. 멤버명, 5. 산업군, 6. 회사 
        // ⚠️ 주의: 전문분야는 멤버가 직접 관리하므로 CSV에 포함되지 않음
        // 7. 권한(선택사항), 8. 비밀번호(선택사항)
        
        // 최소 4개 필드 필요: 이메일, 지역, 챕터, 멤버명
        if (parts.length < 4) {
          throw new Error(`Line ${index + 1}: 최소 4개 필드(이메일, 지역, 챕터, 멤버명)가 필요합니다`);
        }
        
        // 필드 개수에 따라 유연하게 처리
        let password: string = DEFAULT_VALUES.PASSWORD;
        let auth = 'Member';

        // CSV 필드 매핑 (전문분야 제외):
        // 1=이메일, 2=지역, 3=챕터, 4=멤버명, 5=산업군, 6=회사, 7=권한, 8=비밀번호
        
        // 7번째 필드에서 권한 찾기 (인덱스 6) - 전문분야 제거로 한칸 앞당김
        if (parts.length >= 7 && parts[6]) {
          const authField = parts[6];  // 7번째 필드 (권한)
          const authValue = normalizeAuthKeyword(authField);
          if (authValue) {
            auth = authValue;
          }
        }

        // 8번째 필드에서 비밀번호 찾기 (인덱스 7) - 전문분야 제거로 한칸 앞당김
        if (parts.length >= 8 && parts[7]) {
          password = parts[7];
        }
        
        console.log(`🔍 Field analysis for ${parts[0]}:`, {
          partsLength: parts.length,
          auth: auth,
          password: password,
          authField: `parts[6]="${parts[6] || 'empty'}"`,
          passwordField: `parts[7]="${parts[7] || 'empty'}"`,
          note: "전문분야는 CSV에서 제외됨 (멤버 직접 관리)"
        });

        const user = {
          email: parts[0],
          region: parts[1] || '',
          chapter: parts[2] || '',
          memberName: parts[3],
          industry: parts[4] || '',
          company: parts[5] || '',
          specialty: '', // 관리자 추가 시 전문분야는 빈 값으로 설정 (멤버가 직접 관리)
          targetCustomer: '', // 관리자 추가 시 타겟고객은 빈 값으로 설정
          password: password,
          auth: auth
        };
        
        console.log(`👤 Parsed user ${index + 1}:`, {
          email: user.email,
          specialty: user.specialty,
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
            password: user.password || DEFAULT_VALUES.PASSWORD,
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
            password: user.password || DEFAULT_VALUES.PASSWORD,
            auth: user.auth || 'Member'
          });

          processedCount++;
          console.log(`✅ CSV bulk addition completed for ${user.email}`);
        } catch (error: any) {
          console.error(`❌ CSV bulk addition error for ${user.email}:`, error);
          if (error.message.includes('already exists')) {
            errors.push(`${user.email}: 이미 존재하는 멤버입니다`);
          } else {
            errors.push(`${user.email}: ${error.message}`);
          }
        }
      }

      // 성공/오류에 따른 메시지 형식 변경
      const hasErrors = errors.length > 0;
      const responseMessage = hasErrors 
        ? `멤버 일괄 추가 오류 : ${processedCount}명 추가 (${errors.length}명 오류)`
        : `멤버 일괄 추가 성공 : ${processedCount}명 추가`;
        
      const response: any = { 
        message: responseMessage,
        processedCount,
        totalRequested: users.length
      };

      if (hasErrors) {
        response.errors = errors;
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
      const svcR = getGoogleSheetsService();
      if (svcR) svcR.logAdminActivity(req.body.adminEmail || 'admin', '유저 계정 복원', `${restoredCount}명: ${userEmails.join(', ')}`);
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

      if (googleSheetsService) googleSheetsService.logActivity(user.email, '파트너 추천 조회', `필터: ${region || '전체'}`);

      res.json({ recommendations });
    } catch (error) {
      console.error("Business synergy recommendation error:", error);
      res.status(500).json({ message: "비즈니스 시너지 파트너 추천 중 오류가 발생했습니다" });
    }
  });

  // AI 전문분야 분석 및 시너지 추천
  app.get("/api/ai-specialty-analysis/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const forceRefresh = req.query.t; // 타임스탬프로 강제 새로고침 감지
      console.log(`🔍 AI 분석 요청 - userId: ${userId}, forceRefresh: ${!!forceRefresh}`);
      
      // 캐시 무효화 헤더 설정
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      const user = await storage.getUserById(userId);
      if (!user) {
        console.log(`❌ 사용자를 찾을 수 없음 - userId: ${userId}`);
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }
      console.log(`✅ 사용자 발견 - email: ${user.email}, id: ${user.id}`);

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스를 초기화할 수 없습니다" });
      }

      // 사용자 프로필에서 전문분야 가져오기
      const userProfile = await googleSheetsService.getUserProfile(user.email);
      console.log(`🔍 사용자 프로필 조회 - email: ${user.email}, specialty: ${userProfile?.specialty}`);
      
      // 1단계 검증: 지역과 전문분야 정보 확인
      if (!userProfile || !userProfile.specialty || !userProfile.region) {
        console.log(`❌ 필수 정보 없음 - email: ${user.email}, specialty: ${userProfile?.specialty}, region: ${userProfile?.region}`);
        const missingFields = [];
        if (!userProfile?.specialty) missingFields.push('전문분야');
        if (!userProfile?.region) missingFields.push('지역');
        
        return res.status(400).json({ 
          message: `AI 분석을 위해 ${missingFields.join('과 ')} 정보가 필요합니다. 프로필에서 ${missingFields.join('과 ')} 정보를 먼저 입력해주세요.`,
          missingFields
        });
      }

      const { getGeminiService } = await import('./gemini-service.js');
      const geminiService = getGeminiService();

      // AI 분석 실행 (성능 측정) - 매번 새로운 분석 강제 실행
      const startTime = Date.now();
      const timestamp = Date.now();
      console.log(`🚀 AI 분석 새로 시작 - user: ${user.email}, specialty: ${userProfile.specialty}, timestamp: ${timestamp}`);
      
      const analysis = await geminiService.analyzeSpecialtyAndRecommendSynergies(userProfile.specialty);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`✅ AI 분석 완료 - user: ${user.email}, duration: ${duration}ms (${(duration/1000).toFixed(2)}초)`);
      console.log(`📊 새로운 AI 분석 결과 생성 - specialty: ${userProfile.specialty}, analysis length: ${analysis.analysis?.length}자`);

      // 구글 시트에서 모든 활성 멤버 가져오기
      const allUsers = await googleSheetsService.getAllUsers();
      const activeMembers = allUsers.filter(user => user.status === '활동중');

      // 시너지 분야와 매칭되는 멤버 찾기
      const matchingMembers = await geminiService.findMatchingMembers(analysis.synergyFields, activeMembers);

      const responseData = {
        userSpecialty: userProfile.specialty,
        analysis: analysis.analysis,
        synergyFields: analysis.synergyFields,
        priorities: analysis.priorities,
        matchingMembers: matchingMembers.slice(0, 20), // 최대 20명
        totalMatches: matchingMembers.length,
        debugInfo: {
          requestedUserId: userId,
          requestedUserEmail: user.email,
          actualSpecialty: userProfile.specialty,
          timestamp: new Date().toISOString()
        }
      };
      
      console.log(`🎯 AI 분석 응답 전송 - user: ${user.email}, specialty: ${userProfile.specialty}`);

      const sheetsForLog = getGoogleSheetsService();
      if (sheetsForLog) {
        sheetsForLog.logActivity(user.email, 'AI 분석 사용', `전문분야: ${userProfile.specialty}`);
      }

      res.json(responseData);

    } catch (error) {
      console.error(`❌ AI specialty analysis error for userId ${req.params.userId}:`, error);
      res.status(500).json({ message: "AI 전문분야 분석 중 오류가 발생했습니다" });
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



  // 지역 내 업체 검색 API
  app.post("/api/regional-businesses/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const { aiAnalysis, synergyFields } = req.body;
      
      console.log('🔍 지역 업체 검색 API 호출:', { userId, hasAnalysis: !!aiAnalysis });

      // 1단계 검증: 사용자 정보 확인
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }

      const { getGoogleSheetsService } = await import('./google-sheets.js');
      const googleSheetsService = getGoogleSheetsService();
      if (!googleSheetsService) {
        return res.status(500).json({ message: 'Google Sheets service not initialized' });
      }
      const allUsers = await googleSheetsService.getAllUsers();
      const userRow = allUsers.find((u: any) => u.email === user.email);
      
      // 1단계 검증: 지역과 전문분야 정보 확인
      if (!userRow?.specialty || !userRow?.region) {
        console.log(`❌ 필수 정보 없음 - email: ${user.email}, specialty: ${userRow?.specialty}, region: ${userRow?.region}`);
        const missingFields = [];
        if (!userRow?.specialty) missingFields.push('전문분야');
        if (!userRow?.region) missingFields.push('지역');
        
        return res.status(400).json({ 
          message: `지역 업체 검색을 위해 ${missingFields.join('과 ')} 정보가 필요합니다. 프로필에서 ${missingFields.join('과 ')} 정보를 먼저 입력해주세요.`,
          missingFields,
          step: 1
        });
      }

      // 2단계 검증: AI 분석 완료 여부 확인
      if (!aiAnalysis || aiAnalysis.length < 100) {
        console.log(`❌ AI 분석 미완료 - email: ${user.email}, analysisLength: ${aiAnalysis?.length || 0}`);
        return res.status(400).json({ 
          message: "지역 업체 검색을 위해서는 나의 전문분야 AI 분석을 먼저 진행해주세요. 'AI 파트너 추천' 탭에서 '나의 전문분야 분석하기' 버튼을 클릭하세요.",
          step: 2,
          requiresAnalysis: true
        });
      }

      console.log('✅ 1-2단계 검증 완료 - 3단계 네이버 API 검색 시작');

      // PureDynamicSearch를 사용하여 지역 업체 검색
      const { PureDynamicSearch } = await import('./pure-dynamic-search.js');
      const pureDynamicSearch = new PureDynamicSearch();

      const userSpecialty = userRow.specialty;
      const userRegion = userRow.region;

      console.log(`🎯 순수 동적 검색 시작 - PureDynamicSearch 사용`);
      
      // 시너지 필드에서 검색 키워드 추출 (우선순위 기반)
      let searchKeywords = [];
      
      if (synergyFields && typeof synergyFields === 'object') {
        // 우선순위 객체에서 키워드 추출
        const allPriorities = [
          ...(synergyFields.shortTerm || []),
          ...(synergyFields.mediumTerm || []),
          ...(synergyFields.longTerm || [])
        ];
        searchKeywords = allPriorities.slice(0, 5); // 최대 5개
        console.log(`📋 우선순위에서 추출한 키워드: [${searchKeywords.join(', ')}]`);
      }
      
      // AI 분석 텍스트를 키워드와 함께 전달
      const businesses = await pureDynamicSearch.searchPureDynamic(userSpecialty, userRegion, aiAnalysis, searchKeywords);
      console.log(`🎯 순수 동적 검색 완료 - ${businesses?.length || 0}개 업체 발견`);
      
      if (googleSheetsService) googleSheetsService.logActivity(user.email, '지역 업체 검색', `지역: ${userRegion}, 분야: ${userSpecialty}`);

      res.json({
        message: "순수 동적 AI 검색 완료 - 시너지 섹션에서 키워드 직접 추출",
        businesses: businesses || [],
        userSpecialty,
        userRegion
      });
    } catch (error) {
      console.error("지역 업체 검색 오류:", error);
      console.error("Error type:", typeof error);
      console.error("Error name:", (error as any)?.name);
      console.error("Error message:", (error as Error)?.message);
      console.error("Error stack:", (error as Error)?.stack);
      console.error("Full error details:", JSON.stringify(error, null, 2));
      
      // 사용자 데이터 유효성 오류인 경우
      if ((error as Error).message && ((error as Error).message.includes('전문분야') || (error as Error).message.includes('지역 정보'))) {
        res.status(400).json({ 
          message: (error as Error).message,
          businesses: [],
          requiresUserInput: true
        });
      // Gemini API 서비스 오류인 경우  
      } else if ((error as Error).message && (error as Error).message.includes('Gemini API 서비스')) {
        res.status(503).json({ 
          message: (error as Error).message,
          businesses: [],
          serviceError: true
        });
      } else {
        res.status(500).json({ 
          message: "지역 업체 검색 중 오류가 발생했습니다",
          error: (error as Error)?.message || '알 수 없는 오류',
          businesses: []
        });
      }
    }
  });

  // ALPHA 사용자 파트너 단계 데이터 수정 API
  app.post("/api/fix-alpha-stage-data", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }

      const accessToken = await sheetsService.getAccessTokenPublic();
      
      // ALPHA 사용자(133행)의 K열과 N열을 "P"에서 "Profit : 수익단계"로 변경
      const updates = [
        {
          range: "RPS!K133",
          values: [["Profit : 수익단계"]]
        },
        {
          range: "RPS!N133", 
          values: [["Profit : 수익단계"]]
        }
      ];

      for (const update of updates) {
        const updateResponse = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/values/${update.range}?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              values: update.values
            })
          }
        );

        if (!updateResponse.ok) {
          throw new Error(`구글 시트 업데이트 실패: ${updateResponse.statusText}`);
        }
      }

      res.json({
        success: true,
        message: "ALPHA 사용자 파트너 단계 데이터 수정 완료",
        updates: ["K133: Profit : 수익단계", "N133: Profit : 수익단계"]
      });
      
    } catch (error) {
      console.error("ALPHA 데이터 수정 오류:", error);
      res.status(500).json({ message: "데이터 수정 중 오류 발생" });
    }
  });

  // 챕터별 U/V열 데이터 형식 비교 분석 API
  app.get("/api/analyze-chapter-data-formats", async (req, res) => {
    try {
      const sheetsService = getGoogleSheetsService();
      
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }

      const accessToken = await sheetsService.getAccessTokenPublic();
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/values/RPS!A1:V5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 챕터별 사용자 분석
      const chapterAnalysis: Record<string, any[]> = {};

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0] || !row[2]) continue; // 이메일과 챕터가 있는 행만

        const email = row[0];
        const chapter = row[2] as string;
        const uValue = row[20]; // U열
        const vValue = row[21]; // V열

        // ALPHA, Admin, 기타 챕터 분석
        if (['ALPHA', 'Admin', 'Ace', 'All-in-One'].includes(chapter)) {
          if (!chapterAnalysis[chapter]) {
            chapterAnalysis[chapter] = [];
          }

          chapterAnalysis[chapter].push({
            email,
            rowNumber: i + 1,
            uValue,
            vValue,
            uAnalysis: uValue ? {
              value: uValue,
              type: typeof uValue,
              length: uValue.toString().length,
              charCodes: Array.from(uValue.toString() as string).map((char: string) => char.charCodeAt(0)),
              hasSpecialChars: /[^\x20-\x7E]/.test(uValue.toString()),
              isNumeric: !isNaN(Number(uValue)),
              rawValue: JSON.stringify(uValue)
            } : null,
            vAnalysis: vValue ? {
              value: vValue,
              type: typeof vValue,
              length: vValue.toString().length,
              charCodes: Array.from(vValue.toString() as string).map((char: string) => char.charCodeAt(0)),
              hasSpecialChars: /[^\x20-\x7E]/.test(vValue.toString()),
              isNumeric: !isNaN(Number(vValue.toString().replace('%', ''))),
              rawValue: JSON.stringify(vValue)
            } : null
          });
        }
      }

      res.json({
        success: true,
        chapterAnalysis,
        summary: Object.keys(chapterAnalysis).map((chapter: string) => ({
          chapter,
          userCount: chapterAnalysis[chapter].length,
          hasUVData: chapterAnalysis[chapter].filter((user: any) => user.uValue && user.vValue).length
        }))
      });
      
    } catch (error) {
      console.error("챕터 데이터 분석 오류:", error);
      res.status(500).json({ message: "챕터 데이터 분석 중 오류 발생" });
    }
  });

  // 구글 시트 U/V열 실제 값 확인 API  
  app.get("/api/verify-sheets-uv/:userEmail", async (req, res) => {
    try {
      const { userEmail } = req.params;
      const sheetsService = getGoogleSheetsService();
      
      if (!sheetsService) {
        return res.status(500).json({ message: "구글 시트 서비스 초기화 실패" });
      }

      // 직접 구글 시트에서 해당 사용자의 U/V열 값 확인
      const accessToken = await sheetsService.getAccessTokenPublic();
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/values/RPS!A1:V5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 사용자 행 찾기
      const userRowIndex = rows.findIndex((row: any[]) => 
        row[0] && row[0].toString().toLowerCase() === userEmail.toLowerCase()
      );
      
      if (userRowIndex === -1) {
        return res.json({ 
          found: false, 
          message: `사용자 ${userEmail}을 찾을 수 없습니다` 
        });
      }
      
      const userRow = rows[userRowIndex];
      const uValue = userRow[20]; // U열 (index 20)
      const vValue = userRow[21]; // V열 (index 21)
      
      // 🔍 숨겨진 문자 및 데이터 타입 분석
      const uAnalysis = uValue ? {
        value: uValue,
        type: typeof uValue,
        length: uValue.toString().length,
        charCodes: Array.from(uValue.toString() as string).map((char: string) => char.charCodeAt(0)),
        hasSpecialChars: /[^\x20-\x7E]/.test(uValue.toString()),
        isNumeric: !isNaN(Number(uValue)),
        toString: uValue.toString(),
        jsonStringify: JSON.stringify(uValue)
      } : null;

      const vAnalysis = vValue ? {
        value: vValue,
        type: typeof vValue,
        length: vValue.toString().length,
        charCodes: Array.from(vValue.toString() as string).map((char: string) => char.charCodeAt(0)),
        hasSpecialChars: /[^\x20-\x7E]/.test(vValue.toString()),
        isNumeric: !isNaN(Number(vValue.replace('%', ''))),
        toString: vValue.toString(),
        jsonStringify: JSON.stringify(vValue)
      } : null;
      
      res.json({
        found: true,
        userEmail,
        rowNumber: userRowIndex + 1,
        uValue,
        vValue,
        uAnalysis,
        vAnalysis,
        allRowData: userRow.slice(18, 25) // U/V열 주변 데이터만
      });
      
    } catch (error) {
      console.error("구글 시트 검증 오류:", error);
      res.status(500).json({ message: "구글 시트 검증 중 오류 발생" });
    }
  });

  // 이메일로 AI 분석 내용 전송 API
  app.post("/api/send-analysis-email/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const { analysis, userSpecialty } = req.body;
      
      if (!analysis || !userSpecialty) {
        return res.status(400).json({ message: "분석 내용과 전문분야가 필요합니다" });
      }
      
      // 사용자 정보 조회
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "사용자를 찾을 수 없습니다" });
      }
      
      // 현재는 이메일 전송 기능을 시뮬레이션합니다
      // 실제 환경에서는 SendGrid, AWS SES 등의 이메일 서비스를 사용하세요
      console.log('📧 이메일 전송 시뮬레이션:');
      console.log('받는 사람:', user.email);
      console.log('제목: K-BNI.AI 전문분야 분석 결과');
      console.log('내용 길이:', analysis.length, '자');
      
      // 성공 응답
      res.json({ 
        success: true, 
        message: "분석 내용이 이메일로 전송되었습니다",
        recipientEmail: user.email
      });
      
    } catch (error) {
      console.error("이메일 전송 오류:", error);
      res.status(500).json({ message: "이메일 전송 중 오류가 발생했습니다" });
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
