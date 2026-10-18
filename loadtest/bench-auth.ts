// 회원 판정(공유 사본 조회) 함수만 따로 잰다. 합성 데이터만 쓴다.
import EmbeddedPostgres from 'embedded-postgres';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
const dir = path.join(os.tmpdir(), `rps-bench-pg-${process.pid}`);
const pgs = new EmbeddedPostgres({ databaseDir: dir, user: 'rps', password: 'rps', port: 55434, persistent: false, onLog: () => {} });
await pgs.initialise(); await pgs.start(); await pgs.createDatabase('rps');
process.env.DATABASE_URL = 'postgres://rps:rps@127.0.0.1:55434/rps';
process.env.PG_POOL_MAX = process.argv[2] || '5';
const { GoogleSheetsService } = await import('../api/_lib/google-sheets.ts');
const header = ['이메일', ...Array(21).fill('x'), 'ID', 'PW', 'STATUS', 'AUTH'];
const rows = [header, ...Array.from({ length: 2000 }, (_, i) => [`b${i}@x.invalid`, ...Array(21).fill('v'), `b${i}@x.invalid`, '1234', '활동중', 'Member'])];
const svc: any = new GoogleSheetsService({ apiKey: '', spreadsheetId: 's', serviceAccountEmail: 'e', serviceAccountPrivateKey: 'k' } as any);
svc.getCachedFullSheet = async () => rows;
await svc.authenticate('b0@x.invalid', '1234'); // 사본 첫 적재
const lag: number[] = []; let last = Date.now();
const t = setInterval(() => { const n = Date.now(); lag.push(n - last - 10); last = n; }, 10);
const N = 500; const lat: number[] = [];
const t0 = Date.now();
await Promise.all(Array.from({ length: N }, async (_, i) => {
  const s = Date.now(); const r = await svc.authenticate(`b${i}@x.invalid`, '1234'); lat.push(Date.now() - s);
  if (!r.ok) throw new Error('auth failed ' + i);
}));
clearInterval(t);
const p = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
console.log(JSON.stringify({ pool: process.env.PG_POOL_MAX, totalMs: Date.now() - t0, p50: p(lat, .5), p95: p(lat, .95), max: p(lat, 1), loopLagMaxMs: Math.max(...lag) }));
await pgs.stop(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
