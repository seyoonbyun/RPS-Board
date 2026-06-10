import { pool } from './db.js';
import { SHEET_CACHE_CONFIG } from './constants.js';

/**
 * 인스턴스 간(서버리스 다중 인스턴스) 캐시 무효화를 위한 공유 버전 토큰.
 *
 * 근본 원인: 시트 읽기 캐시는 인스턴스별 메모리라, 한 인스턴스의 쓰기가 다른
 * 인스턴스의 캐시를 비우지 못해 앱이 옛값을 보였다. 모든 인스턴스가 공유하는 DB에
 * 단일 정수 버전을 두고, 쓰기 때 +1, 읽기 때 비교하여 바뀌었으면 새로 읽는다.
 *
 * 설계 원칙:
 *  - 절대 throw 하지 않는다(읽기/쓰기 본흐름을 깨지 않음). 실패 시 기존 TTL 백스톱으로 자가복구.
 *  - 버전 조회는 VERSION_CHECK_TTL_MS 동안 마이크로캐시하여 DB 부하를 인스턴스당
 *    '초당 1회 미만'으로 제한. 이 간격이 곧 쓰기→타 인스턴스 반영의 최대 지연.
 *  - 마이그레이션 불필요: CREATE TABLE IF NOT EXISTS 로 자체 보장.
 */

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS sheet_cache_version (
           id int PRIMARY KEY,
           version bigint NOT NULL DEFAULT 0
         );
         INSERT INTO sheet_cache_version (id, version) VALUES (1, 0)
         ON CONFLICT (id) DO NOTHING;`,
      )
      .then(() => undefined)
      .catch((err) => {
        console.warn('cache-version ensureTable failed:', err?.message || err);
        ensured = null; // 다음 호출에서 재시도
      });
  }
  return ensured;
}

/** 쓰기 후 호출: 공유 버전을 올려 모든 인스턴스가 다음 읽기에서 새로 읽게 한다. */
export async function bumpCacheVersion(): Promise<void> {
  if (!pool) return;
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO sheet_cache_version (id, version) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET version = sheet_cache_version.version + 1`,
    );
  } catch (err: any) {
    console.warn('bumpCacheVersion failed (캐시는 TTL 백스톱으로 복구):', err?.message || err);
  }
}

let cachedVersion = 0;
let cachedVersionAt = 0;

/**
 * 공유 버전을 읽는다(마이크로캐시). 실패하면 마지막으로 알던 값을 반환.
 * now 는 Date.now() 를 주입(서버리스에서 매 요청 시각 전달).
 */
export async function readCacheVersion(now: number): Promise<number> {
  if (!pool) return 0;
  if (now - cachedVersionAt < SHEET_CACHE_CONFIG.VERSION_CHECK_TTL_MS) {
    return cachedVersion;
  }
  cachedVersionAt = now;
  try {
    await ensureTable();
    const r = await pool.query('SELECT version FROM sheet_cache_version WHERE id = 1');
    const v = r?.rows?.[0]?.version;
    if (v !== undefined && v !== null) cachedVersion = Number(v);
  } catch (err: any) {
    console.warn('readCacheVersion failed (마지막 값 사용):', err?.message || err);
  }
  return cachedVersion;
}
