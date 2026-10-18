import { pool } from './db.js';
import { getGoogleSheetsService } from './google-sheets.js';
import { runInBackground } from './background.js';

/**
 * 시트에 쓸 일을 DB 에 먼저 적어 두고(outbox), 응답은 바로 돌려준다.
 * 시트 반영은 '배출(drain)'이 맡는다 — 한 번에 한 인스턴스만, 여러 건을 묶어 한 번의 호출로.
 *
 * 예전: 로그인 1번 = 시트 2번(기록), 저장 1번 = 시트 3번 + 바뀐 칸마다 2번.
 *       500명이 몰리면 구글 한도(분당 약 300건)를 넘어 응답이 늘어지거나 실패했다.
 * 지금: 로그인·저장 응답은 DB 쓰기만 기다린다. 시트 호출 수는 접속자 수가 아니라 배출 횟수에 비례한다.
 *
 * 순서·중복 규칙
 *  - 같은 회원의 보드 저장이 여러 건 쌓이면 **가장 최근 것만** 시트에 쓴다(전체 행을 쓰므로 그걸로 충분).
 *  - 실패한 건은 지우지 않고 뒤로 미룬다(백오프, 최대 10분 간격). 예전처럼 5번 실패 후 삭제하지 않는다.
 *  - 활동 기록은 시트에 붙인 뒤 지운다. 붙인 직후 지우기 전에 죽으면 같은 줄이 한 번 더 붙을 수 있다(유실보다 낫다).
 */

const DRAIN_LEASE_MS = 55_000;       // 배출 담당 한 인스턴스. 죽어도 이 시간 뒤엔 다른 인스턴스가 이어받는다
const DRAIN_TIME_BUDGET_MS = 40_000; // 기록 배출을 시작할 수 있는 마감(함수 상한 60초 안)
const ACTIVITY_BATCH = 1000;
const SYNC_BATCH = 200;
const KICK_MIN_GAP_MS = 3_000;       // 인스턴스마다 배출 시도 간격
/**
 * 전체(모든 인스턴스 합계) 배출 간격. 구글 시트 한도는 서비스 계정 하나당 읽기·쓰기 각각 분당 60건이다.
 * 배출 한 번 = 읽기 1 + 쓰기 최대 2 이므로 5초 간격이면 분당 읽기 12·쓰기 24건 이하로 묶인다.
 * 그래도 한 번에 저장 200건·기록 1000줄을 보내므로 분당 저장 2,400건까지 따라잡는다.
 */
const DRAIN_MIN_GAP_MS = 5_000;

let ensured: Promise<boolean> | null = null;
function ensureTables(): Promise<boolean> {
  if (!pool) return Promise.resolve(false);
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS activity_outbox (
           id bigserial PRIMARY KEY,
           created_at timestamptz NOT NULL DEFAULT now(),
           ts_text text NOT NULL,
           email text NOT NULL,
           action text NOT NULL,
           details text NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS outbox_lease (
           name text PRIMARY KEY,
           lease_until timestamptz,
           last_started_at timestamptz,
           last_ok_at timestamptz,
           last_error text
         );
         CREATE TABLE IF NOT EXISTS pending_sheet_syncs (
           id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
           user_email text NOT NULL,
           operation text NOT NULL,
           payload json NOT NULL,
           error_message text,
           retry_count integer DEFAULT 0,
           created_at timestamp DEFAULT now(),
           next_retry_at timestamp DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS pending_sheet_syncs_email_idx ON pending_sheet_syncs (lower(user_email));
         CREATE INDEX IF NOT EXISTS pending_sheet_syncs_due_idx ON pending_sheet_syncs (next_retry_at);`,
      )
      .then(() => true)
      .catch((err: any) => {
        console.warn('outbox ensureTables failed:', err?.message || err);
        ensured = null;
        return false;
      });
  }
  return ensured;
}

/** 예전 logActivity 와 같은 시각 표기(서버 로컬 시각) */
function tsText(d = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())},${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export interface ActivityEntry { email: string; action: string; details?: string }

/**
 * 활동 기록을 남긴다. DB 에 적히면 바로 돌아온다.
 * DB 를 못 쓰면 예전처럼 시트에 직접 쓰되, 응답을 오래 붙잡지 않도록 시간 제한을 둔다.
 */
export async function recordActivities(entries: ActivityEntry[]): Promise<'queued' | 'direct' | 'failed'> {
  if (entries.length === 0) return 'queued';
  const ts = tsText();
  if (await ensureTables()) {
    try {
      await pool!.query(
        `INSERT INTO activity_outbox (ts_text, email, action, details)
         SELECT $1, e, a, d FROM unnest($2::text[], $3::text[], $4::text[]) AS t(e, a, d)`,
        [ts, entries.map((e) => e.email), entries.map((e) => e.action), entries.map((e) => e.details || '')],
      );
      return 'queued';
    } catch (err: any) {
      console.warn('activity outbox insert failed — 시트 직접 기록:', err?.message || err);
    }
  }
  const sheets = getGoogleSheetsService();
  if (!sheets) return 'failed';
  try {
    await withTimeout(sheets.appendActivityRows(entries.map((e) => [ts, e.email, e.action, e.details || ''])), 5_000);
    return 'direct';
  } catch (err: any) {
    console.error('activity direct write failed:', err?.message || err);
    return 'failed';
  }
}

/** 보드 저장의 시트 반영을 예약한다. DB 에 적혔으면 true. */
export async function queueScoreboardSync(userEmail: string, payload: any): Promise<boolean> {
  if (!(await ensureTables())) return false;
  try {
    await pool!.query(
      `INSERT INTO pending_sheet_syncs (user_email, operation, payload, retry_count, next_retry_at)
       VALUES ($1, 'syncScoreboard', $2::json, 0, now())`,
      [userEmail, JSON.stringify(payload)],
    );
    return true;
  } catch (err: any) {
    console.warn('queueScoreboardSync failed:', err?.message || err);
    return false;
  }
}

/** 이 회원의 저장 중 아직 시트에 안 간 것이 있나 — 있으면 DB 값이 시트보다 새것이다. */
export async function hasPendingSync(userEmail: string): Promise<boolean> {
  if (!(await ensureTables())) return false;
  try {
    const r = await pool!.query(
      `SELECT 1 FROM pending_sheet_syncs WHERE lower(user_email) = lower($1) AND operation = 'syncScoreboard' LIMIT 1`,
      [userEmail],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms); }),
  ]);
}

async function tryLease(name: string): Promise<boolean> {
  const r = await pool!.query(
    `INSERT INTO outbox_lease (name, lease_until, last_started_at) VALUES ($1, now() + ($2 || ' milliseconds')::interval, now())
     ON CONFLICT (name) DO UPDATE SET lease_until = EXCLUDED.lease_until, last_started_at = now()
       WHERE (outbox_lease.lease_until IS NULL OR outbox_lease.lease_until < now())
         AND (outbox_lease.last_started_at IS NULL
              OR outbox_lease.last_started_at < now() - ($3 || ' milliseconds')::interval)
     RETURNING name`,
    [name, String(DRAIN_LEASE_MS), String(DRAIN_MIN_GAP_MS)],
  );
  return r.rows.length > 0;
}

async function releaseLease(name: string, error: string | null): Promise<void> {
  await pool!.query(
    `UPDATE outbox_lease SET lease_until = NULL,
            last_ok_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_ok_at END,
            last_error = $2
      WHERE name = $1`,
    [name, error],
  ).catch(() => {});
}

export interface DrainResult {
  ran: boolean;
  activities: number;
  syncs: number;
  syncFailures: number;
  error?: string;
}

/** 활동 기록 한 묶음을 시트에 붙인다. 붙인 수를 돌려준다. */
async function drainActivities(sheets: NonNullable<ReturnType<typeof getGoogleSheetsService>>): Promise<number> {
  const client = await (pool as any).connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, ts_text, email, action, details FROM activity_outbox
        ORDER BY id LIMIT ${ACTIVITY_BATCH} FOR UPDATE SKIP LOCKED`,
    );
    if (r.rows.length === 0) { await client.query('COMMIT'); return 0; }
    await sheets.appendActivityRows(r.rows.map((x: any) => [x.ts_text, x.email, x.action, x.details]));
    await client.query('DELETE FROM activity_outbox WHERE id = ANY($1::bigint[])', [r.rows.map((x: any) => x.id)]);
    await client.query('COMMIT');
    return r.rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 보드 저장 한 묶음을 시트에 반영한다. [반영 수, 실패 수] */
async function drainSyncs(sheets: NonNullable<ReturnType<typeof getGoogleSheetsService>>): Promise<[number, number]> {
  const client = await (pool as any).connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, user_email, operation, payload, retry_count FROM pending_sheet_syncs
        WHERE next_retry_at <= now()
        ORDER BY created_at, id LIMIT ${SYNC_BATCH} FOR UPDATE SKIP LOCKED`,
    );
    if (r.rows.length === 0) { await client.query('COMMIT'); return [0, 0]; }

    // 예전 경로가 남긴 'logActivity' 재시도 건은 활동 기록 묶음으로 보낸다.
    const legacyLogs = r.rows.filter((x: any) => x.operation === 'logActivity');
    if (legacyLogs.length) {
      await sheets.appendActivityRows(legacyLogs.map((x: any) => {
        const p = x.payload || {};
        return [tsText(new Date()), p.email || x.user_email, p.action || '', p.details || ''];
      }));
      await client.query('DELETE FROM pending_sheet_syncs WHERE id = ANY($1::varchar[])', [legacyLogs.map((x: any) => x.id)]);
    }

    // 회원별 가장 최근 저장만 쓴다(행 전체를 쓰므로 이전 저장은 그 안에 덮인다).
    const latest = new Map<string, any>();
    const idsByEmail = new Map<string, string[]>();
    for (const x of r.rows.filter((y: any) => y.operation === 'syncScoreboard')) {
      const k = String(x.user_email).trim().toLowerCase();
      latest.set(k, x);
      idsByEmail.set(k, [...(idsByEmail.get(k) || []), x.id]);
    }
    let ok = 0;
    let failed = 0;
    if (latest.size) {
      const payloads = Array.from(latest.values()).map((x: any) => ({ ...(x.payload || {}), userEmail: x.payload?.userEmail || x.user_email }));
      const outcome = await sheets.syncScoreboardBatch(payloads);
      for (const [k, x] of Array.from(latest.entries())) {
        const err = outcome.get(k);
        const ids = idsByEmail.get(k) || [];
        if (err === null) {
          await client.query('DELETE FROM pending_sheet_syncs WHERE id = ANY($1::varchar[])', [ids]);
          ok++;
        } else {
          const retry = (x.retry_count ?? 0) + 1;
          const delayMs = Math.min(600_000, 15_000 * 2 ** Math.min(retry - 1, 6));
          await client.query(
            `UPDATE pending_sheet_syncs SET retry_count = $2, error_message = $3,
                    next_retry_at = now() + ($4 || ' milliseconds')::interval
              WHERE id = ANY($1::varchar[])`,
            [ids, retry, (err || 'not processed').slice(0, 500), String(delayMs)],
          );
          failed++;
        }
      }
    }
    await client.query('COMMIT');
    return [ok, failed];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 쌓인 것을 시트로 내보낸다. 다른 인스턴스가 이미 하고 있으면 바로 돌아온다(ran=false).
 * 시트가 429·장애면 아무것도 지우지 않고 다음 기회로 넘긴다.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const res: DrainResult = { ran: false, activities: 0, syncs: 0, syncFailures: 0 };
  if (!(await ensureTables())) return res;
  const sheets = getGoogleSheetsService();
  if (!sheets) return res;
  if (!(await tryLease('sheets-drain').catch(() => false))) return res;
  res.ran = true;
  const deadline = Date.now() + DRAIN_TIME_BUDGET_MS;
  let error: string | null = null;
  try {
    // 저장 반영을 먼저(회원이 다른 화면·리포트에서 보게 될 값), 기록은 그다음.
    // 한 번에 한 묶음씩만 — 남은 것은 5초 뒤 다음 배출이 가져간다(한도 안에서 꾸준히).
    const [ok, failed] = await drainSyncs(sheets);
    res.syncs += ok;
    res.syncFailures += failed;
    if (Date.now() < deadline) res.activities += await drainActivities(sheets);
  } catch (err: any) {
    error = String(err?.message || err).slice(0, 500);
    res.error = error;
    console.warn('outbox drain stopped (다음 기회에 이어서):', error);
  } finally {
    await releaseLease('sheets-drain', error);
  }
  if (res.syncs || res.activities) {
    console.log(`📤 outbox drained: ${res.syncs} syncs, ${res.activities} activities${res.syncFailures ? `, ${res.syncFailures} failed` : ''}`);
  }
  return res;
}

let lastKick = 0;
let running: Promise<unknown> | null = null;

/**
 * 요청이 들어올 때마다 부르는 가벼운 신호. 인스턴스마다 3초에 한 번만 실제로 배출을 시도하고,
 * 응답을 기다리게 하지 않는다. 서버리스에서 응답 뒤에도 끝까지 돌도록 waitUntil 에 맡긴다.
 */
export function kickDrain(): void {
  const now = Date.now();
  if (running || now - lastKick < KICK_MIN_GAP_MS || !pool) return;
  lastKick = now;
  running = drainOutbox()
    .catch((err) => console.warn('kickDrain error:', err?.message || err))
    .finally(() => { running = null; });
  runInBackground(running);
}

/** 관리자 화면·점검용: 밀린 양과 가장 오래된 건의 나이 */
export async function outboxStatus(): Promise<{ activities: number; syncs: number; oldestSyncAgeSec: number | null; lastOkAt: string | null; lastError: string | null }> {
  if (!(await ensureTables())) return { activities: 0, syncs: 0, oldestSyncAgeSec: null, lastOkAt: null, lastError: null };
  const a = await pool!.query('SELECT count(*)::int AS n FROM activity_outbox');
  const s = await pool!.query(
    `SELECT count(*)::int AS n, EXTRACT(EPOCH FROM (now() - min(created_at)))::int AS age FROM pending_sheet_syncs`,
  );
  const l = await pool!.query(`SELECT last_ok_at, last_error FROM outbox_lease WHERE name = 'sheets-drain'`);
  return {
    activities: a.rows[0].n,
    syncs: s.rows[0].n,
    oldestSyncAgeSec: s.rows[0].age ?? null,
    lastOkAt: l.rows[0]?.last_ok_at ? new Date(l.rows[0].last_ok_at).toISOString() : null,
    lastError: l.rows[0]?.last_error ?? null,
  };
}
