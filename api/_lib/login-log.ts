import { pool } from './db.js';

/**
 * 로그인 실패를 남긴다. 이게 없으면 **탐지 채널이 회원의 컴플레인 하나뿐**이라,
 * 몇 명이 겪었는지·원인이 무엇인지 영원히 알 수 없다.
 *
 * 설계 원칙 (cache-version.ts 와 동일):
 *  - 절대 throw 하지 않는다. 기록 실패가 로그인을 막으면 본말전도다.
 *  - 마이그레이션 불필요: CREATE TABLE IF NOT EXISTS 로 자체 보장.
 *  - 비밀번호는 어떤 형태로도 남기지 않는다.
 */
export type LoginReason =
  | 'OK'
  | 'INVALID_INPUT'
  | 'NOT_REGISTERED'
  | 'BAD_PASSWORD'
  | 'WITHDRAWN'
  | 'RATE_LIMITED'
  | 'SHEET_UNAVAILABLE'
  | 'INTERNAL';

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS login_attempts (
           id bigserial PRIMARY KEY,
           at timestamptz NOT NULL DEFAULT now(),
           email text,
           reason text NOT NULL,
           ip text
         );
         CREATE INDEX IF NOT EXISTS login_attempts_at_idx ON login_attempts (at DESC);`,
      )
      .then(() => undefined)
      .catch((err) => {
        console.warn('login-log ensureTable failed:', err?.message || err);
        ensured = null;
      });
  }
  return ensured;
}

/** 성공은 남기지 않는다(볼륨). 실패만 남긴다. */
export async function recordLoginFailure(
  email: string | undefined,
  reason: LoginReason,
  ip?: string,
): Promise<void> {
  if (!pool || reason === 'OK') return;
  try {
    await ensureTable();
    await pool.query(
      'INSERT INTO login_attempts (email, reason, ip) VALUES ($1, $2, $3)',
      [email ? email.toLowerCase().slice(0, 200) : null, reason, ip ? ip.slice(0, 60) : null],
    );
  } catch (err: any) {
    console.warn('recordLoginFailure failed:', err?.message || err);
  }
}

/** 관리자 화면용 요약: 최근 N시간 사유별 건수 + 최근 실패 목록. */
export async function loginFailureSummary(hours = 24): Promise<{
  since: string;
  byReason: { reason: string; count: number }[];
  recent: { at: string; email: string | null; reason: string }[];
}> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  if (!pool) return { since, byReason: [], recent: [] };
  await ensureTable();
  const agg = await pool.query(
    `SELECT reason, count(*)::int AS count FROM login_attempts
      WHERE at > $1 GROUP BY reason ORDER BY count DESC`,
    [since],
  );
  const recent = await pool.query(
    `SELECT at, email, reason FROM login_attempts
      WHERE at > $1 ORDER BY at DESC LIMIT 100`,
    [since],
  );
  return { since, byReason: agg.rows, recent: recent.rows };
}
