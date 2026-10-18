import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginGuard, DEFAULT_LOGIN_GUARD_LIMITS } from '../api/_lib/login-guard.js';

test('같은 IP 의 서로 다른 계정 500명 정상 로그인은 막지 않는다', () => {
  const g = new LoginGuard(DEFAULT_LOGIN_GUARD_LIMITS, () => 1_000);
  let blocked = 0;
  for (let i = 0; i < 500; i++) if (!g.check('198.18.0.1', `m${i}@example.invalid`).ok) blocked++;
  assert.equal(blocked, 0);
});

test('같은 계정 연타는 5회 뒤 막힌다', () => {
  const g = new LoginGuard(DEFAULT_LOGIN_GUARD_LIMITS, () => 1_000);
  const r = Array.from({ length: 6 }, () => g.check('1.1.1.1', 'A@x.invalid').ok);
  assert.deepEqual(r, [true, true, true, true, true, false]);
});

test('계정별 실패 10회면 잠기고 창이 지나면 풀린다', () => {
  let now = 0;
  const g = new LoginGuard(DEFAULT_LOGIN_GUARD_LIMITS, () => now);
  for (let i = 0; i < 10; i++) { now += 11_000; g.recordFailure(`10.0.0.${i}`, 'a@x.invalid'); }
  now += 11_000;
  const v = g.check('9.9.9.9', 'a@x.invalid');
  assert.equal(v.ok, false);
  now += 10 * 60_000;
  assert.equal(g.check('9.9.9.9', 'a@x.invalid').ok, true);
});

test('IP 실패가 100회 쌓이면 그 IP 만 막힌다', () => {
  const g = new LoginGuard(DEFAULT_LOGIN_GUARD_LIMITS, () => 1_000);
  for (let i = 0; i < 100; i++) g.recordFailure('6.6.6.6', `spray${i}@x.invalid`);
  assert.equal(g.check('6.6.6.6', 'new@x.invalid').ok, false);
  assert.equal(g.check('7.7.7.7', 'new@x.invalid').ok, true);
});
