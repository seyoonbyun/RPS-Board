import crypto from 'crypto';
import type { ScoreboardData } from './schema.js';

/**
 * DB(Postgres)가 죽어도 **로그인과 보드 조회는 살린다**.
 *
 * 2026-08-28 Neon 컴퓨트가 disabled 되자 전 회원이 로그인 불가가 됐다.
 * 인증의 정본은 구글시트인데 식별자(user.id)를 DB에서만 얻는 구조라 전면 정지했다.
 * DB를 못 쓰는 동안에는 **이메일을 식별자로** 쓰고, 보드 값은 시트에서 채운다.
 * 쓰기(저장)는 대신할 수 없으므로 조용히 넘기지 않고 명확히 거절한다.
 */
const SHEET_ID_PREFIX = 'sheet:';

/**
 * 대체 식별자는 **서명**한다.
 * 그냥 `sheet:<이메일>` 로 두면 남의 이메일만 알면 그 사람 보드를 읽을 수 있다
 * (기존 DB uuid 는 추측 불가라서 그게 사실상의 접근 통제였다). 그 수준을 유지한다.
 */
function idSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_SHEETS_ID ||
    'rps-board-fallback-secret'
  );
}

function sign(email: string): string {
  return crypto.createHmac('sha256', idSecret()).update(email).digest('base64url').slice(0, 22);
}

export function sheetUserId(email: string): string {
  const e = email.trim().toLowerCase();
  const payload = Buffer.from(e, 'utf8').toString('base64url');
  return `${SHEET_ID_PREFIX}${payload}.${sign(e)}`;
}

/** 서명이 맞는 대체 식별자만 이메일로 되돌린다. 아니면 null. */
export function emailFromUserId(userId: string): string | null {
  if (!userId || !userId.startsWith(SHEET_ID_PREFIX)) return null;
  const rest = userId.slice(SHEET_ID_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  let email: string;
  try {
    email = Buffer.from(payload, 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email) return null;
  const expected = sign(email);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return email;
}

export function isSheetUserId(userId: string): boolean {
  return Boolean(emailFromUserId(userId));
}

/**
 * 시트 프로필로 보드 초기값을 만든다.
 * DB 미러가 없을 때 **빈 폼을 보여주지 않기 위한** 것 — 빈 폼은 회원이 덮어써서 지우게 만든다.
 */
export function scoreboardFromProfile(userId: string, profile: any): ScoreboardData {
  return {
    id: `sheet-${userId}`,
    userId,
    region: profile?.region || '',
    userIdField: '',
    partner: profile?.chapter || '',
    memberName: profile?.memberName || '',
    industry: profile?.industry || '',
    company: profile?.company || '',
    specialty: profile?.specialty || '',
    targetCustomer: profile?.targetCustomer || '',
    rpartner1: profile?.rpartner1 || '',
    rpartner1Specialty: profile?.rpartner1Specialty || '',
    rpartner1Stage: profile?.rpartner1Stage || '',
    rpartner2: profile?.rpartner2 || '',
    rpartner2Specialty: profile?.rpartner2Specialty || '',
    rpartner2Stage: profile?.rpartner2Stage || '',
    rpartner3: profile?.rpartner3 || '',
    rpartner3Specialty: profile?.rpartner3Specialty || '',
    rpartner3Stage: profile?.rpartner3Stage || '',
    rpartner4: profile?.rpartner4 || '',
    rpartner4Specialty: profile?.rpartner4Specialty || '',
    rpartner4Stage: profile?.rpartner4Stage || '',
    updatedAt: new Date(),
  } as ScoreboardData;
}
