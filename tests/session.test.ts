import { test, before } from 'node:test';
import assert from 'node:assert/strict';

before(() => {
  process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
  delete process.env.DATABASE_URL;
});

test('서명 세션은 왕복되고, 위조·만료는 거절된다', async () => {
  const { encodeSession, decodeSession } = await import('../api/_lib/session.js');
  const t = encodeSession({ email: 'A@X.invalid', auth: 'Member' }, 1_000)!;
  assert.equal(decodeSession(t, 2_000)?.email, 'a@x.invalid');
  const [payload, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'admin@x.invalid', auth: 'Admin', exp: 9e15 })).toString('base64url');
  assert.equal(decodeSession(`${forged}.${sig}`, 2_000), null);
  assert.equal(decodeSession(`${payload}.${sig}x`, 2_000), null);
  assert.equal(decodeSession(t, 1_000 + 31 * 24 * 3600_000), null);
});

async function startApp(mode: string) {
  process.env.AUTH_ENFORCE = mode;
  const express = (await import('express')).default;
  const { registerRoutes } = await import('../api/_lib/routes.js');
  const { encodeSession, SESSION_COOKIE } = await import('../api/_lib/session.js');
  const { sheetUserId } = await import('../api/_lib/degraded.js');
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as any).port;
  const cookieFor = (email: string) => `${SESSION_COOKIE}=${encodeURIComponent(encodeSession({ email, auth: 'Member' })!)}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);
  return { server, call, cookieFor, sheetUserId };
}

test('AUTH_ENFORCE=on: 세션 없이·남의 것·관리자 전용 경로를 막는다', async () => {
  const { server, call, cookieFor, sheetUserId } = await startApp('on');
  try {
    const bob = sheetUserId('bob@x.invalid');
    // 회원 API: 세션 없음 → 401
    assert.equal((await call(`/api/scoreboard/${encodeURIComponent(bob)}`)).status, 401);
    // 남의 보드 → 403
    const r = await call(`/api/scoreboard/${encodeURIComponent(bob)}`, { headers: { cookie: cookieFor('eve@x.invalid') } });
    assert.equal(r.status, 403);
    // 비밀번호를 돌려주던 디버그 주소: 세션 없이 → 401
    assert.equal((await call('/api/debug/user/bob@x.invalid')).status, 401);
    // 헤더로 관리자 이메일을 주장해도 세션이 없으면 → 401
    assert.equal((await call('/api/admin/users', { headers: { 'x-caller-email': 'admin@x.invalid' } })).status, 401);
    // 세션은 eve 인데 헤더는 admin → 403
    assert.equal((await call('/api/admin/users', { headers: { cookie: cookieFor('eve@x.invalid'), 'x-caller-email': 'admin@x.invalid' } })).status, 403);
    // 다른 사이트 출처의 쓰기 → 403
    const x = await call(`/api/scoreboard/${encodeURIComponent(bob)}`, {
      method: 'POST', headers: { cookie: cookieFor('bob@x.invalid'), origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(x.status, 403);
  } finally { server.close(); }
});

test('AUTH_ENFORCE=on: 본인 세션이면 권한 단계를 통과한다(이후 단계의 시트 미설정 오류까지 간다)', async () => {
  const { server, call, cookieFor, sheetUserId } = await startApp('on');
  try {
    const bob = sheetUserId('bob@x.invalid');
    const r = await call(`/api/scoreboard/${encodeURIComponent(bob)}`, { headers: { cookie: cookieFor('bob@x.invalid') } });
    assert.ok(![401, 403].includes(r.status), `status ${r.status}`);
  } finally { server.close(); }
});

test('AUTH_ENFORCE=report: 막지 않는다(기존 로그인 상태 유지)', async () => {
  const { server, call, sheetUserId } = await startApp('report');
  try {
    const bob = sheetUserId('bob@x.invalid');
    const r = await call(`/api/scoreboard/${encodeURIComponent(bob)}`);
    assert.ok(![401, 403].includes(r.status), `status ${r.status}`);
  } finally { server.close(); }
});
