import { pool } from './db.js';
import { readCacheVersion } from './cache-version.js';
import { runInBackground } from './background.js';

/**
 * 구글 시트 '공유 사본'.
 *
 * 문제: 서버리스는 접속이 몰리면 인스턴스가 수십~수백 개 새로 뜨고, 각자 RPS 시트 전체를 읽었다.
 *       구글 시트 API 는 프로젝트당 분당 약 300건이라 500명이 몰리면 429 가 나고,
 *       그게 로그인 실패("회원 정보를 불러오지 못했습니다")로 이어졌다.
 *
 * 해결: 시트 내용을 Neon 에 행 단위로 한 벌 두고(sheet_rows) 모든 인스턴스가 그걸 읽는다.
 *       - 로그인·내 보드 조회는 **내 행 하나**만 읽는다(인덱스 조회, 수 KB).
 *       - 갱신은 '임대(lease)'를 얻은 한 인스턴스만 하고, 나머지는 기다리지 않고 직전 사본을 쓴다.
 *       → 접속자 수와 무관하게 구글 시트 읽기는 몇 초에 최대 1번.
 *
 * 신선도: 웹 저장이 시트에 반영되면 공유 버전(cache-version)이 올라 다음 읽기에서 갱신되고,
 *         시트를 직접 고친 경우에도 FRESH_MS 안에 반영된다.
 * DB 가 없거나 죽으면 예전처럼 시트를 직접 읽는다(기존 인스턴스 캐시 경로).
 */

const FRESH_MS = 60_000;           // 쓰기가 없어도 이 시간이 지나면 새로 읽는다(시트 직접 수정 반영)
const MIN_REFRESH_GAP_MS = 5_000;  // 쓰기가 몰려도 시트 읽기는 이 간격보다 자주 하지 않는다
const LEASE_MS = 30_000;           // 갱신 담당 인스턴스가 죽어도 이 시간 뒤엔 다른 인스턴스가 이어받는다
const META_CHECK_MS = 1_000;       // 같은 인스턴스 안에서는 이 간격 안이면 메타도 다시 안 본다
const FIRST_LOAD_WAIT_MS = 15_000; // 사본이 아예 없을 때만, 다른 인스턴스의 첫 적재를 기다리는 한도

export type SnapshotSource = 'snapshot' | 'refreshed' | 'stale' | 'direct';

export interface SnapshotMeta {
  /** 이 사본을 시트에서 읽기 시작한 시각(ms). 저장값과 어느 쪽이 새것인지 가르는 기준. */
  fetchedAt: number;
  source: SnapshotSource;
}

type FetchFresh = () => Promise<string[][]>;

let ensured: Promise<boolean> | null = null;
function ensureTables(): Promise<boolean> {
  if (!pool) return Promise.resolve(false);
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS sheet_snapshot (
           id text PRIMARY KEY,
           fetched_at_ms bigint,
           source_version bigint,
           row_count int,
           lease_until timestamptz
         );
         CREATE TABLE IF NOT EXISTS sheet_rows (
           sheet_key text NOT NULL,
           row_idx int NOT NULL,
           email_lower text,
           row jsonb NOT NULL,
           PRIMARY KEY (sheet_key, row_idx)
         );
         CREATE INDEX IF NOT EXISTS sheet_rows_email_idx ON sheet_rows (sheet_key, email_lower);`,
      )
      .then(() => true)
      .catch((err: any) => {
        console.warn('sheet-snapshot ensureTables failed:', err?.message || err);
        ensured = null;
        return false;
      });
  }
  return ensured;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 이 인스턴스가 마지막으로 본 메타(1초 안이면 재사용) */
const metaMem = new Map<string, { meta: SnapshotMeta; checkedAt: number }>();
/** 전체 행이 필요한 호출(관리자 목록 등)용 — fetchedAt 이 같으면 재사용 */
const fullMem = new Map<string, { rows: string[][]; fetchedAt: number }>();

async function tryLease(key: string): Promise<boolean> {
  const r = await pool!.query(
    `INSERT INTO sheet_snapshot (id, lease_until) VALUES ($1, now() + ($2 || ' milliseconds')::interval)
     ON CONFLICT (id) DO UPDATE SET lease_until = EXCLUDED.lease_until
       WHERE sheet_snapshot.lease_until IS NULL OR sheet_snapshot.lease_until < now()
     RETURNING id`,
    [key, String(LEASE_MS)],
  );
  return r.rows.length > 0;
}

/** 시트 전체를 사본으로 교체한다. 한 트랜잭션이라 읽는 쪽은 옛 사본 또는 새 사본 중 하나만 본다. */
async function writeSnapshot(key: string, rows: string[][], fetchedAt: number, version: number): Promise<void> {
  const client = await (pool as any).connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sheet_rows WHERE sheet_key = $1', [key]);
    await client.query(
      `INSERT INTO sheet_rows (sheet_key, row_idx, email_lower, row)
       SELECT $1, (t.ord - 1)::int, NULLIF(lower(trim(t.elem->>0)), ''), t.elem
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(elem, ord)`,
      [key, JSON.stringify(rows.map((r) => r || []))],
    );
    await client.query(
      `UPDATE sheet_snapshot SET fetched_at_ms = $2, source_version = $3, row_count = $4, lease_until = NULL WHERE id = $1`,
      [key, fetchedAt, version, rows.length],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function refresh(key: string, fetchFresh: FetchFresh, version: number): Promise<SnapshotMeta> {
  const startedAt = Date.now();
  try {
    const rows = await fetchFresh();
    await writeSnapshot(key, rows, startedAt, version);
    fullMem.set(key, { rows, fetchedAt: startedAt });
    console.log(`📸 sheet snapshot refreshed (${key}): ${rows.length} rows`);
    const meta: SnapshotMeta = { fetchedAt: startedAt, source: 'refreshed' };
    metaMem.set(key, { meta, checkedAt: Date.now() });
    return meta;
  } catch (err) {
    await pool!.query('UPDATE sheet_snapshot SET lease_until = NULL WHERE id = $1', [key]).catch(() => {});
    throw err;
  }
}

const inflight = new Map<string, Promise<SnapshotMeta | null>>();

/**
 * 사본이 쓸 만한지 보고, 낡았으면 (임대를 얻은 경우에만) 갱신한다.
 *  - 사본이 있으면 갱신은 **뒤에서** 하고 지금 요청은 직전 사본으로 바로 답한다 — 로그인이 시트 읽기를 기다리지 않는다.
 *  - 사본이 아예 없을 때(최초 배포 직후)만 첫 적재를 기다린다.
 *  - 같은 인스턴스 안에서 동시에 들어온 확인은 한 번으로 합친다.
 * @returns null 이면 DB 를 쓸 수 없다 → 호출한 쪽이 시트를 직접 읽는다.
 */
export function ensureSnapshot(key: string, fetchFresh: FetchFresh): Promise<SnapshotMeta | null> {
  const cached = metaMem.get(key);
  if (cached && Date.now() - cached.checkedAt < META_CHECK_MS) return Promise.resolve(cached.meta);
  const running = inflight.get(key);
  if (running) return running;
  const p = checkSnapshot(key, fetchFresh).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function checkSnapshot(key: string, fetchFresh: FetchFresh): Promise<SnapshotMeta | null> {
  const now = Date.now();
  if (!(await ensureTables())) return null;

  let fetchedAt = 0;
  let sourceVersion = -1;
  let version: number;
  try {
    version = await readCacheVersion(now);
    const r = await pool!.query('SELECT fetched_at_ms, source_version FROM sheet_snapshot WHERE id = $1', [key]);
    fetchedAt = Number(r.rows[0]?.fetched_at_ms || 0);
    sourceVersion = Number(r.rows[0]?.source_version ?? -1);
  } catch (err: any) {
    console.warn('sheet-snapshot meta read failed — 시트 직접 읽기:', err?.message || err);
    return null;
  }

  const remember = (meta: SnapshotMeta) => {
    metaMem.set(key, { meta, checkedAt: Date.now() });
    return meta;
  };

  const hasSnapshot = fetchedAt > 0;
  if (hasSnapshot && sourceVersion === version && now - fetchedAt < FRESH_MS) {
    return remember({ fetchedAt, source: 'snapshot' });
  }

  const tooSoon = hasSnapshot && now - fetchedAt < MIN_REFRESH_GAP_MS;
  let leased = false;
  if (!tooSoon) {
    try {
      leased = await tryLease(key);
    } catch (err: any) {
      console.warn('sheet-snapshot lease failed:', err?.message || err);
    }
  }

  if (hasSnapshot) {
    if (leased) {
      runInBackground(refresh(key, fetchFresh, version).catch((err: any) =>
        console.warn(`sheet-snapshot refresh failed (${key}) — 직전 사본 계속 사용:`, err?.message || err)));
    }
    return remember({ fetchedAt, source: 'stale' });
  }

  // 사본이 아직 한 번도 없다(최초 배포 직후).
  if (leased) return refresh(key, fetchFresh, version);
  const deadline = Date.now() + FIRST_LOAD_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(100 + Math.floor(Math.random() * 100));
    const r = await pool!.query('SELECT fetched_at_ms FROM sheet_snapshot WHERE id = $1', [key]);
    const at = Number(r.rows[0]?.fetched_at_ms || 0);
    if (at > 0) return remember({ fetchedAt: at, source: 'snapshot' });
  }
  return null;
}

/** 헤더(0행)는 사본이 바뀔 때만 다시 읽는다. */
const headerMem = new Map<string, { header: string[]; fetchedAt: number }>();

/** 헤더(0행)와 이메일이 맞는 행 하나. 없으면 row = null. 이메일 조회는 색인만 탄다. */
export async function getSharedRowByEmail(
  key: string,
  email: string,
  fetchFresh: FetchFresh,
): Promise<{ header: string[]; row: string[] | null; rowIndex: number; meta: SnapshotMeta } | null> {
  const meta = await ensureSnapshot(key, fetchFresh);
  if (!meta) return null;
  try {
    let h = headerMem.get(key);
    if (!h || h.fetchedAt !== meta.fetchedAt) {
      const hr = await pool!.query('SELECT row FROM sheet_rows WHERE sheet_key = $1 AND row_idx = 0', [key]);
      h = { header: hr.rows[0]?.row || [], fetchedAt: meta.fetchedAt };
      headerMem.set(key, h);
    }
    const r = await pool!.query(
      `SELECT row_idx, row FROM sheet_rows WHERE sheet_key = $1 AND email_lower = $2 ORDER BY row_idx LIMIT 1`,
      [key, email.trim().toLowerCase()],
    );
    const hit = r.rows[0];
    return { header: h.header, row: hit ? hit.row : null, rowIndex: hit ? hit.row_idx : -1, meta };
  } catch (err: any) {
    console.warn('sheet-snapshot row read failed — 시트 직접 읽기:', err?.message || err);
    return null;
  }
}

/** 전체 행(관리자 목록 등 드문 호출). fetchedAt 이 같으면 인스턴스 메모리를 재사용한다. */
export async function getSharedSheetRows(
  key: string,
  fetchFresh: FetchFresh,
): Promise<{ rows: string[][]; meta: SnapshotMeta } | null> {
  const meta = await ensureSnapshot(key, fetchFresh);
  if (!meta) return null;
  const m = fullMem.get(key);
  if (m && m.fetchedAt === meta.fetchedAt) return { rows: m.rows, meta };
  try {
    const r = await pool!.query('SELECT row_idx, row FROM sheet_rows WHERE sheet_key = $1 ORDER BY row_idx', [key]);
    const rows: string[][] = [];
    for (const x of r.rows as any[]) rows[x.row_idx] = x.row;
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    fullMem.set(key, { rows, fetchedAt: meta.fetchedAt });
    return { rows, meta };
  } catch (err: any) {
    console.warn('sheet-snapshot full read failed — 시트 직접 읽기:', err?.message || err);
    return null;
  }
}

/** 시험용 */
export function __resetSnapshotMemory() {
  metaMem.clear();
  fullMem.clear();
  headerMem.clear();
}
