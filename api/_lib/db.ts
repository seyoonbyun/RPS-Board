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

if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
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

export { pool, db };
