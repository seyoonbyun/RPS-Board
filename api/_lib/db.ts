import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import { createRequire } from 'module';
import * as schema from "./schema.js";

neonConfig.webSocketConstructor = ws;

/** pool.query / pool.connect 만 쓰므로 Neon·node-postgres 둘 다 같은 모양으로 다룬다. */
type AnyPool = NeonPool;

let pool: AnyPool | null = null;
let db: ReturnType<typeof drizzleNeon> | null = null;

/**
 * 연결 수는 '인스턴스 수 × max' 만큼 열린다. 서버리스는 동시 접속이 몰리면 인스턴스가 수십~수백 개
 * 뜨므로, 예전 max 100 은 DB 연결 한도를 금방 넘긴다. 짧은 쿼리만 쓰므로 인스턴스당 몇 개면 충분하다.
 * 운영 DATABASE_URL 은 Neon 의 pooled 주소(호스트에 -pooler)여야 한다.
 */
const POOL_MAX = Math.max(1, parseInt(process.env.PG_POOL_MAX || '5', 10) || 5);

/**
 * Vercel Storage 로 붙인 Neon(rps-db)은 NEON_DATABASE_URL 로 들어온다(미리보기는 배포마다 브랜치 주소).
 * 옛 DATABASE_URL(꺼진 Replit Neon)은 운영 전환 전까지 남아 있으므로 새 주소를 먼저 본다.
 */
export const DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';

if (DATABASE_URL) {
  const url = DATABASE_URL;
  const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  if (isLocal) {
    // 로컬 시험(embedded Postgres)용 — 운영 경로에는 영향 없음.
    const require = createRequire(import.meta.url);
    const pg = require('pg');
    const { drizzle: drizzlePg } = require('drizzle-orm/node-postgres');
    pool = new pg.Pool({ connectionString: url, max: POOL_MAX, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 }) as any;
    db = drizzlePg({ client: pool as any, schema }) as any;
  } else {
    if (!/-pooler\./.test(url)) {
      console.warn('⚠️ DATABASE_URL 이 Neon pooled 주소(-pooler)가 아니다 — 동시 접속이 몰리면 연결 한도에 걸릴 수 있다');
    }
    pool = new NeonPool({
      connectionString: url,
      max: POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    db = drizzleNeon({ client: pool, schema });
  }
  pool!.on('error', (err: unknown) => {
    console.error('Database pool error:', err);
  });
} else {
  console.warn('⚠️ DATABASE_URL not set — running without Postgres (Google Sheets only mode)');
}

/**
 * 회원·보드 테이블을 스스로 만든다. 새 Neon(rps-db)은 빈 DB 로 시작하고, 미리보기는 배포마다 브랜치가 생기므로
 * drizzle-kit push 를 사람이 돌리는 단계에 기대지 않는다. shared/schema.ts 와 같은 모양.
 */
let coreEnsured: Promise<void> | null = null;
export function ensureCoreTables(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!coreEnsured) {
    coreEnsured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS users (
           id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
           email text NOT NULL UNIQUE,
           password text NOT NULL,
           created_at timestamp DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS scoreboard_data (
           id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
           user_id varchar NOT NULL REFERENCES users(id),
           region text, user_id_field text, partner text, member_name text,
           industry text, company text, specialty text, target_customer text,
           rpartner1 text, rpartner1_specialty text, rpartner1_stage text,
           rpartner2 text, rpartner2_specialty text, rpartner2_stage text,
           rpartner3 text, rpartner3_specialty text, rpartner3_stage text,
           rpartner4 text, rpartner4_specialty text, rpartner4_stage text,
           updated_at timestamp DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS change_history (
           id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
           user_id varchar NOT NULL REFERENCES users(id),
           field_name text NOT NULL,
           old_value text,
           new_value text,
           "timestamp" timestamp DEFAULT now()
         );`,
      )
      .then(() => undefined)
      .catch((err: any) => {
        console.warn('ensureCoreTables failed:', err?.message || err);
        coreEnsured = null;
      });
  }
  return coreEnsured;
}

export { pool, db };
