/**
 * 500명 동시 접속 시험 (합성 회원 · 로컬 Postgres · 가짜 구글 시트).
 *
 *   npx tsx loadtest/run.ts [--root <앱 폴더>] [--users 500] [--workers 16] [--duration 150] [--poolmax 5] [--out result.json]
 *
 * 무엇을 흉내 내나
 *  - 서버리스 인스턴스 여러 개 = 워커 프로세스 여러 개. 요청은 아무 워커에나 떨어진다(인스턴스별 캐시가 따로 논다).
 *  - 구글 시트 한도 = 서비스 계정 1개 기준 읽기·쓰기 각각 분당 60건(넘으면 429).
 *  - 회원 행동 = 10초 안에 500명 로그인 → 첫 화면 조회 → 20초 안에 각자 한 번 저장 → 30초마다 화면 새로고침.
 * 무엇을 재나
 *  - 로그인·저장·조회 실패 수(어떤 이유든 2xx 가 아니면 실패), 응답 시간 p50/p95/max
 *  - 저장 직후·이후 새로고침에서 값이 옛 값으로 돌아간 횟수
 *  - 끝난 뒤 시트에 모든 저장이 들어갔는지, 로그인·저장 기록이 빠짐없이 붙었는지
 */
import { fork, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { startFakeGoogle } from './fake-google.mjs';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const USERS = Number(arg('users', '500'));
const WORKERS = Number(arg('workers', '16'));
const DURATION_S = Number(arg('duration', '150'));
const POOL_MAX = arg('poolmax', '5');
/** 가상 사용자마다 다른 IP(x-forwarded-for). 없으면 전원이 같은 IP — 행사장·사무실 상황 */
const SPOOF_IP = process.argv.includes('--spoof-ip');
/** 워커 로그를 버린다(Windows 에서 파일 로그 쓰기가 측정에 끼어드는지 가르는 용도) */
const QUIET = process.argv.includes('--quiet');
/**
 * 실제 배포(예: Vercel 미리보기)에 보낼 때: --target https://... --users-file 시험계정.json
 * 보호된 미리보기는 환경변수 RPS_BYPASS(Protection Bypass for Automation), 배출은 CRON_SECRET 환경변수.
 * 이 모드에서는 로컬 DB·가짜 시트·워커를 띄우지 않는다. 시트 대조는 별도 스크립트로 한다.
 */
const TARGET = arg('target', '').replace(/\/$/, '');
const USERS_FILE = arg('users-file', '');
const OUT = arg('out', path.join(os.tmpdir(), `rps-loadtest-${Date.now()}.json`));
const LOGIN_WINDOW_MS = 10_000;
const SAVE_WINDOW_MS = 20_000;
const POLL_MS = 30_000;
const PG_PORT = 55433;
const FAKE_PORT = 58100;
const BASE_PORT = 58200;
const CRON_SECRET = 'loadtest-cron-secret-0123456789';
const DB_URL = `postgres://rps:rps@127.0.0.1:${PG_PORT}/rps`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- 합성 시트 ----------
const HEADER = ['이메일', '지역', '챕터', '멤버명', '산업군', '회사', '전문분야', '나의 핵심 고객층',
  ' R파트너 1', ' R파트너 1 : 전문분야 ', ' R파트너 1 : V-C-P', 'R파트너 2', ' R파트너 2 :  전문분야 ', ' R파트너 2 : V-C-P',
  'R파트너 3', ' R파트너 3 : 전문분야 ', ' R파트너 3 : V-C-P', 'R파트너 4', ' R파트너 4 : 전문분야 ', ' R파트너 4 : V-C-P',
  '총 R파트너 수', '달성', 'ID', 'PW', 'STATUS', 'AUTH'];
interface VU { email: string; pin: string }
const vus: VU[] = [];
const rps: string[][] = [HEADER];
for (let i = 0; i < USERS + 1500; i++) {
  const email = i < USERS ? `lt-${String(i).padStart(4, '0')}@example.invalid` : `filler-${i}@example.invalid`;
  const pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  if (i < USERS) vus.push({ email, pin });
  rps.push([email, '시험지역', `챕터${i % 40}`, `멤버${i}`, '업종', '회사', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    '0', '0%', email, pin, '활동중', 'Member']);
}
const sheets: Record<string, string[][]> = { RPS: rps, ActivityLog: [['Timestamp', 'Email', 'Action', 'Details']], Auth: [['x']] };

// ---------- 측정 ----------
type Op = 'login' | 'profile' | 'scoreboard' | 'permission' | 'save';
const lat: Record<Op, number[]> = { login: [], profile: [], scoreboard: [], permission: [], save: [] };
const fails: Record<string, number> = {};
const failSamples: string[] = [];
let reverts = 0;
const revertSamples: string[] = [];
const fail = (op: string, why: string) => {
  const k = `${op}:${why}`;
  fails[k] = (fails[k] || 0) + 1;
  if (failSamples.length < 20) failSamples.push(k);
};
const pct = (a: number[], p: number) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function call(op: Op, method: string, p: string, body: any, cookie: string | null, ip?: string) {
  const port = BASE_PORT + Math.floor(Math.random() * WORKERS);
  const base = TARGET || `http://127.0.0.1:${port}`;
  const t = Date.now();
  try {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(SPOOF_IP && ip ? { 'x-forwarded-for': ip } : {}), ...(process.env.RPS_BYPASS ? { 'x-vercel-protection-bypass': process.env.RPS_BYPASS } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(65_000),
    });
    const text = await r.text();
    lat[op].push(Date.now() - t);
    if (!r.ok) fail(op, `${r.status} ${text.slice(0, 80)}`);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* */ }
    const st = r.headers.get('server-timing');
    if (st) for (const part of st.split(',')) {
      const [name, dur] = part.trim().split(';dur=');
      (serverTiming[`${op}.${name}`] ||= []).push(Number(dur));
    }
    return { ok: r.ok, status: r.status, json, setCookie: r.headers.get('set-cookie') };
  } catch (e: any) {
    lat[op].push(Date.now() - t);
    fail(op, e?.name === 'TimeoutError' ? 'timeout' : `neterr ${e?.cause?.code || ''} ${e?.message} port=${port}`);
    return { ok: false, status: 0, json: null, setCookie: null };
  }
}

const serverTiming: Record<string, number[]> = {};
const workerExits: string[] = [];
const saved = new Map<string, string>();
let loginsOk = 0;
let savesOk = 0;

async function user(vu: VU, i: number, endAt: number) {
  const ip = `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  await sleep(rand(0, LOGIN_WINDOW_MS));
  const lr = await call('login', 'POST', '/api/auth/login', { email: vu.email, password: vu.pin }, null, ip);
  if (!lr.ok) return;
  loginsOk++;
  const cookie = lr.setCookie ? lr.setCookie.split(';')[0] : null;
  const id = encodeURIComponent(lr.json.user.id);
  await Promise.all([
    call('profile', 'GET', `/api/user-profile/${id}`, null, cookie, ip),
    call('scoreboard', 'GET', `/api/scoreboard/${id}`, null, cookie, ip),
    call('permission', 'POST', '/api/admin/check-permission', { email: vu.email }, cookie, ip),
  ]);

  await sleep(Math.max(0, LOGIN_WINDOW_MS + rand(0, SAVE_WINDOW_MS) - (Date.now() - startedAt)));
  const spec = `전문-${i}-${Math.floor(Math.random() * 1e6)}`;
  const form = {
    region: '시험지역', partner: `챕터${i % 40}`, memberName: `멤버${i}`, industry: '업종', company: '회사',
    specialty: spec, targetCustomer: `고객-${i}`,
    rpartner1: `파트너A-${i}`, rpartner1Specialty: '세무', rpartner1Stage: 'Profit : 수익단계',
    rpartner2: `파트너B-${i}`, rpartner2Specialty: '노무', rpartner2Stage: 'Credibility : 신뢰단계',
  };
  const sr = await call('save', 'POST', `/api/scoreboard/${id}`, form, cookie, ip);
  if (sr.ok) { savesOk++; saved.set(vu.email, spec); }

  const check = async (when: string) => {
    const pr = await call('profile', 'GET', `/api/user-profile/${id}`, null, cookie, ip);
    await call('scoreboard', 'GET', `/api/scoreboard/${id}`, null, cookie, ip);
    if (pr.ok && saved.has(vu.email) && pr.json?.specialty !== saved.get(vu.email)) {
      reverts++;
      if (revertSamples.length < 10) revertSamples.push(`${vu.email} ${when}: got "${pr.json?.specialty}"`);
    }
  };
  await check('after-save');
  while (Date.now() + POLL_MS < endAt) {
    await sleep(POLL_MS + rand(-2000, 2000));
    await check('poll');
  }
}

let startedAt = 0;

async function mainRemote() {
  const list = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users as VU[];
  vus.length = 0;
  vus.push(...list.slice(0, USERS));
  console.log(`▶ target=${TARGET} users=${vus.length} duration=${DURATION_S}s`);
  startedAt = Date.now();
  const endAt = startedAt + DURATION_S * 1000;
  await Promise.all(vus.map((vu, i) => user(vu, i, endAt)));
  const loadMs = Date.now() - startedAt;
  const drains: any[] = [];
  const cron = process.env.CRON_SECRET || '';
  for (let k = 0; cron && k < 30; k++) {
    await sleep(6_000);
    const r = await fetch(`${TARGET}/api/cron/drain`, {
      headers: { authorization: `Bearer ${cron}`, ...(process.env.RPS_BYPASS ? { 'x-vercel-protection-bypass': process.env.RPS_BYPASS } : {}) },
    });
    const j = await r.json().catch(() => ({ status: r.status }));
    drains.push(j);
    if (j.ran && j.syncs === 0 && j.activities === 0) break;
  }
  const summary = {
    target: TARGET, users: vus.length, durationS: DURATION_S, loadMs,
    loginsOk, savesOk, failures: fails, failSamples,
    latencyMs: Object.fromEntries(Object.entries(lat).map(([k, a]) => [k, { n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: pct(a, 100) }])),
    serverTimingMs: Object.fromEntries(Object.entries(serverTiming).map(([k, a]) => [k, { n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: pct(a, 100) }])),
    reverts, revertSamples, drains,
    saved: Object.fromEntries(saved),
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  const { saved: _s, ...brief } = summary;
  console.log(JSON.stringify(brief, null, 2));
  console.log(`▶ result: ${OUT}`);
  process.exit(0);
}

async function main() {
  if (TARGET) return mainRemote();
  console.log(`▶ root=${ROOT} users=${USERS} workers=${WORKERS} duration=${DURATION_S}s spoofIp=${SPOOF_IP}`);
  const pgDir = path.join(os.tmpdir(), `rps-lt-pg-${process.pid}`);
  const pgsrv = new EmbeddedPostgres({ databaseDir: pgDir, user: 'rps', password: 'rps', port: PG_PORT, persistent: false, onLog: () => {} });
  await pgsrv.initialise();
  await pgsrv.start();
  await pgsrv.createDatabase('rps');
  execSync('npx drizzle-kit push --force', { cwd: ROOT, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'ignore' });

  const fake = await startFakeGoogle({ port: FAKE_PORT, sheets });
  const logDir = path.join(os.tmpdir(), `rps-lt-logs-${process.pid}`);
  fs.mkdirSync(logDir, { recursive: true });
  const kids = [] as ReturnType<typeof fork>[];
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise<void>((resolve, reject) => {
    const out = fs.openSync(path.join(logDir, `w${w}.log`), 'w');
    const k = fork(path.join(ROOT, 'loadtest', 'worker.ts'), [], {
      execArgv: ['--import', 'tsx'],
      cwd: ROOT,
      stdio: QUIET ? ['ignore', 'ignore', 'ignore', 'ipc'] : ['ignore', out, out, 'ipc'],
      env: {
        ...process.env, PORT: String(BASE_PORT + w), FAKE_GOOGLE_PORT: String(FAKE_PORT), APP_ROOT: ROOT,
        DATABASE_URL: DB_URL, PG_POOL_MAX: POOL_MAX, SESSION_SECRET: 'loadtest-session-secret-0123456789abcdef',
        AUTH_ENFORCE: 'on', CRON_SECRET, NODE_ENV: 'development',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'loadtest@example.invalid',
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nloadtest\n-----END PRIVATE KEY-----\n',
        GOOGLE_SHEETS_ID: 'loadtest-sheet',
      },
    });
    kids.push(k);
    k.on('message', (m: any) => m?.ready && resolve());
    k.on('exit', (c) => { workerExits.push(`w${w} exit=${c}`); reject(new Error(`worker ${w} exited ${c}`)); });
  })));
  console.log(`▶ ${WORKERS} workers ready, logs: ${logDir}`);

  startedAt = Date.now();
  const endAt = startedAt + DURATION_S * 1000;
  await Promise.all(vus.map((vu, i) => user(vu, i, endAt)));
  const loadMs = Date.now() - startedAt;

  // 남은 시트 반영 끝내기 (정기 배출 경로로)
  const drainStart = Date.now();
  let lastDrain: any = null;
  while (Date.now() - drainStart < 180_000) {
    const r = await fetch(`http://127.0.0.1:${BASE_PORT}/api/cron/drain`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    lastDrain = await r.json().catch(() => null);
    const pending = await countPending();
    if (pending.syncs === 0 && pending.activities === 0) break;
    await sleep(5_500);
  }
  const drainMs = Date.now() - drainStart;
  const pendingAfter = await countPending();

  // 시트 검증
  const st: any = await (await fetch(`http://127.0.0.1:${FAKE_PORT}/__state`)).json();
  const rowByEmail = new Map<string, string[]>();
  for (const r of st.sheets.RPS) if (r?.[0]) rowByEmail.set(String(r[0]).toLowerCase(), r);
  let sheetMismatch = 0;
  const mismatchSamples: string[] = [];
  for (const [email, spec] of Array.from(saved.entries())) {
    const r = rowByEmail.get(email);
    if (!r || r[6] !== spec || r[23] !== vus.find((v) => v.email === email)!.pin) {
      sheetMismatch++;
      if (mismatchSamples.length < 10) mismatchSamples.push(`${email}: sheet G="${r?.[6]}" PW="${r?.[23]}" want "${spec}"`);
    }
  }
  const act = st.sheets.ActivityLog.slice(1).filter((r: string[]) => String(r[1]).startsWith('lt-'));
  const loginLogs = new Set(act.filter((r: string[]) => /로그인/.test(r[2])).map((r: string[]) => r[1])).size;
  const saveLogs = new Set(act.filter((r: string[]) => /데이터 (수정|입력)/.test(r[2])).map((r: string[]) => r[1])).size;

  const summary = {
    root: ROOT, spoofIp: SPOOF_IP, users: USERS, workers: WORKERS, durationS: DURATION_S, loadMs, drainMs,
    loginsOk, savesOk,
    failures: fails, failSamples,
    latencyMs: Object.fromEntries(Object.entries(lat).map(([k, a]) => [k, { n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: pct(a, 100) }])),
    serverTimingMs: Object.fromEntries(Object.entries(serverTiming).map(([k, a]) => [k, { n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: pct(a, 100) }])),
    reverts, revertSamples,
    sheet: { savedChecked: saved.size, mismatch: sheetMismatch, mismatchSamples, loginLogUsers: loginLogs, saveLogUsers: saveLogs },
    workerExits,
    pendingAfter, lastDrain,
    google: st.stats,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`▶ result: ${OUT}`);

  for (const k of kids) k.kill();
  await sleep(500);
  fake.server.close();
  await pgsrv.stop();
  fs.rmSync(pgDir, { recursive: true, force: true });
  process.exit(0);
}

async function countPending(): Promise<{ syncs: number; activities: number }> {
  const pg = (await import('pg')).default;
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const q = async (sql: string) => {
      try { return (await c.query(sql)).rows[0].n as number; } catch { return 0; }
    };
    return {
      syncs: await q('SELECT count(*)::int AS n FROM pending_sheet_syncs'),
      activities: await q('SELECT count(*)::int AS n FROM activity_outbox'),
    };
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
