import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestQueue } from '../api/_lib/request-queue.js';
// 큐가 요청마다 남기는 로그(이모지 포함)가 node:test 의 자식 프로세스 통신과 섞여
// 'Unable to deserialize cloned data' 로 시험 파일 전체가 실패 처리되는 일이 있었다 — 이 파일에서는 끈다.
console.log = () => {};

const withDeadline = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('deadline')), ms))]);

test('큐 작업 안에서 다시 enqueue 해도 멈추지 않는다', async () => {
  const v = await withDeadline(requestQueue.enqueue('outer', async () =>
    (await requestQueue.enqueue('inner', async () => 41)) + 1));
  assert.equal(v, 42);
});

test('같은 lockKey 를 중첩해도 스스로 교착되지 않는다', async () => {
  const v = await withDeadline(requestQueue.enqueue('outer', async () =>
    requestQueue.enqueue('inner', async () => 'ok', 'user:a'), 'user:a'));
  assert.equal(v, 'ok');
});

test('동시 슬롯을 다 채운 바깥 작업들이 각자 안쪽 작업을 기다려도 끝난다', async () => {
  const jobs = Array.from({ length: 120 }, (_, i) =>
    requestQueue.enqueue(`o${i}`, async () => requestQueue.enqueue(`i${i}`, async () => i)));
  const r = await withDeadline(Promise.all(jobs), 5000);
  assert.equal(r.length, 120);
});

test('같은 lockKey 의 작업은 순서대로 하나씩 실행된다', async () => {
  let running = 0, maxRunning = 0;
  const job = () => requestQueue.enqueue('l', async () => {
    running++; maxRunning = Math.max(maxRunning, running);
    await new Promise(r => setTimeout(r, 20)); running--;
  }, 'user:b');
  await withDeadline(Promise.all([job(), job(), job()]));
  assert.equal(maxRunning, 1);
});

test.after(() => requestQueue.destroy());
