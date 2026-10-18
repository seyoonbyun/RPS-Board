// 서버리스 인스턴스 하나를 흉내 내는 프로세스. 운영과 같은 진입점(api/index.ts handler)을 쓴다.
// 구글 호출은 가짜 서버로 돌리고, 토큰 발급은 건너뛴다. 실제 구글·실제 DB 에는 닿지 않는다.
import http from 'node:http';

const FAKE = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT}`;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('https://sheets.googleapis.com')) url = FAKE + url.slice('https://sheets.googleapis.com'.length);
  else if (!url.startsWith('http://127.0.0.1')) {
    return new Response('blocked in loadtest', { status: 599 });
  }
  return realFetch(url, init);
}) as any;

const root = (process.env.APP_ROOT || process.cwd()).replace(/\\/g, '/');
const { GoogleSheetsService } = await import(`file:///${root}/api/_lib/google-sheets.ts`);
(GoogleSheetsService as any).prototype.getAccessToken = async () => 'fake';
const { default: handler } = await import(`file:///${root}/api/index.ts`);

const server = http.createServer((req, res) => {
  // Vercel 처럼 req.body 를 미리 채우지 않는다 — 앱의 express.json() 이 읽는다.
  handler(req, res);
});
server.keepAliveTimeout = 30_000;
server.listen(Number(process.env.PORT), '127.0.0.1', () => process.send?.({ ready: true }));
