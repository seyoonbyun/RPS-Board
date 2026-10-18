import crypto from 'crypto';

/**
 * 서버가 발급하는 로그인 세션 (서명 쿠키).
 *
 * 예전에는 서버가 "누가 부르는지"를 확인하지 않았다.
 *  - 회원 API 는 주소의 userId 만 봤고
 *  - 관리자 API 는 요청에 적힌 x-caller-email 헤더(누구나 써넣을 수 있는 값)를 믿었다.
 *
 * 로그인 방식(이메일 + 4자리)은 그대로다. 로그인에 성공하면 서버가 서명한 쿠키를 하나 더 줄 뿐이다.
 * DB 가 아니라 서명으로 확인하므로 Neon 이 멈춰도, 서버가 재시작·배포돼도 로그인이 유지된다.
 *
 * 전환 스위치 AUTH_ENFORCE
 *  - off    : 확인하지 않는다(예전과 동일)
 *  - report : 확인하되 막지 않고 기록만 한다(기본값) — 쿠키 없는 기존 로그인 상태를 끊지 않는다
 *  - on     : 쿠키 없거나 남의 것이면 막는다(401/403)
 */

export const SESSION_COOKIE = 'rps_sid';
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const SESSION_REFRESH_BELOW_MS = 15 * 24 * 3600_000;

export type AuthMode = 'off' | 'report' | 'on';

export function authMode(): AuthMode {
  const v = (process.env.AUTH_ENFORCE || 'report').trim().toLowerCase();
  return v === 'off' || v === 'on' ? v : 'report';
}

export interface SessionUser {
  email: string;
  auth: string;
  /** 만료 시각(ms) */
  exp: number;
}

/**
 * 서명 키. 고정 문자열로 떨어지면 누구나 세션을 만들 수 있으므로 그때는 발급하지 않는다.
 * 운영에는 이미 서비스 계정 키가 있어 SESSION_SECRET 을 따로 넣지 않아도 동작한다(넣는 것을 권장).
 */
function secret(): string | null {
  const s = process.env.SESSION_SECRET || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  return s.length >= 32 ? s : null;
}

function mac(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(`rps-session.v1.${payload}`).digest('base64url');
}

export function encodeSession(user: Omit<SessionUser, 'exp'>, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const body: SessionUser = { email: user.email.trim().toLowerCase(), auth: user.auth, exp: now + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${mac(payload, key)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): SessionUser | null {
  const key = secret();
  if (!key || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(payload, key));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionUser;
    if (typeof body.email !== 'string' || typeof body.exp !== 'number' || body.exp <= now) return null;
    return body;
  } catch {
    return null;
  }
}

function readCookie(req: any, name: string): string | undefined {
  const header: string = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function cookieAttrs(maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function setSessionCookie(res: any, user: Omit<SessionUser, 'exp'>): boolean {
  const token = encodeSession(user);
  if (!token) {
    console.warn('⚠️ session secret 없음 — 세션 쿠키를 발급하지 않는다 (SESSION_SECRET 설정 필요)');
    return false;
  }
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(SESSION_TTL_MS / 1000)}`);
  return true;
}

export function clearSessionCookie(res: any): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
}

/** 모든 요청에 붙인다: req.session 을 채우고, 만료가 가까우면 조용히 연장한다. */
export function attachSession(req: any, res: any, next: any) {
  const s = decodeSession(readCookie(req, SESSION_COOKIE));
  req.sessionUser = s;
  if (s && s.exp - Date.now() < SESSION_REFRESH_BELOW_MS) {
    setSessionCookie(res, { email: s.email, auth: s.auth });
  }
  next();
}

/**
 * 막을지 판단한다. report 모드에서는 기록만 하고 통과시킨다.
 * @returns true 면 호출한 쪽은 즉시 return 해야 한다(응답을 이미 보냈다).
 */
export function denyIfEnforced(req: any, res: any, status: 401 | 403, code: string, detail: string): boolean {
  const mode = authMode();
  if (mode === 'off') return false;
  console.warn(`🔐 auth ${mode === 'on' ? 'DENY' : 'would-deny'} [${code}] ${req.method} ${req.path} — ${detail}`);
  if (mode === 'report') return false;
  res.status(status).json({
    code,
    message: status === 401
      ? '로그인이 필요합니다. 이메일과 4자리 비밀번호로 다시 로그인해주세요.'
      : '이 정보에 접근할 권한이 없습니다.',
  });
  return true;
}

/**
 * 쓰기 요청의 출처 확인(다른 사이트가 회원 브라우저를 빌려 저장하는 것 방지).
 * SameSite=Lax 쿠키가 1차 방어이고, 이것은 보조다. Origin 이 없으면(구형 브라우저·서버 호출) 통과.
 */
export function sameOriginWrite(req: any): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers?.origin as string | undefined;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers?.host;
  } catch {
    return false;
  }
}
