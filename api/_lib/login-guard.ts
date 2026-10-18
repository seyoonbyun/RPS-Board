/**
 * 로그인 남용 방어.
 *
 * 예전 제한기는 "IP 하나당 10초에 5회"였다. 한 사무실·행사장(공유 공인 IP)에서
 * 500명이 같이 로그인하면 495명이 정상 계정인데도 막혔다(2026-10-16 오프라인 재현).
 *
 * 그래서 **정상 로그인은 IP 로 세지 않는다.** 막는 기준은 두 가지뿐이다.
 *  - 계정별: 짧은 시간 연타(중복 클릭·스크립트)와 누적 실패(4자리 PIN 추측)
 *  - IP 별: **실패**가 많이 쌓일 때만(여러 계정에 PIN 을 뿌리는 패턴)
 *
 * 메모리 카운트라 서버리스 인스턴스마다 따로 센다. 정확한 전역 제한은 DB 세션 단계에서 옮긴다.
 */

export interface LoginGuardLimits {
  /** 같은 계정의 시도 간격 제한(성공·실패 무관) */
  emailBurstWindowMs: number;
  emailBurstMax: number;
  /** 같은 계정의 실패 누적 → 잠시 잠금 */
  emailFailWindowMs: number;
  emailFailMax: number;
  /** 같은 IP 의 실패 누적 → 잠시 차단 (정상 로그인은 세지 않는다) */
  ipFailWindowMs: number;
  ipFailMax: number;
  /** 메모리 정리 기준 */
  maxKeys: number;
}

export const DEFAULT_LOGIN_GUARD_LIMITS: LoginGuardLimits = {
  emailBurstWindowMs: 10_000,
  emailBurstMax: 5,
  emailFailWindowMs: 10 * 60_000,
  emailFailMax: 10,
  ipFailWindowMs: 5 * 60_000,
  ipFailMax: 100,
  maxKeys: 5000,
};

export type LoginGuardVerdict =
  | { ok: true }
  | { ok: false; scope: 'EMAIL_BURST' | 'EMAIL_FAILURES' | 'IP_FAILURES'; retryAfterMs: number };

type Clock = () => number;

class SlidingCounter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number, private maxKeys: number) {}

  count(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const kept = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  add(key: string, now: number): void {
    const kept = this.count(key, now);
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > this.maxKeys) this.prune(now);
  }

  retryAfter(kept: number[], now: number): number {
    return kept.length ? Math.max(0, kept[0] + this.windowMs - now) : 0;
  }

  private prune(now: number): void {
    for (const key of Array.from(this.hits.keys())) this.count(key, now);
  }
}

export class LoginGuard {
  private emailBurst: SlidingCounter;
  private emailFail: SlidingCounter;
  private ipFail: SlidingCounter;

  constructor(private limits: LoginGuardLimits = DEFAULT_LOGIN_GUARD_LIMITS, private now: Clock = Date.now) {
    this.emailBurst = new SlidingCounter(limits.emailBurstWindowMs, limits.maxKeys);
    this.emailFail = new SlidingCounter(limits.emailFailWindowMs, limits.maxKeys);
    this.ipFail = new SlidingCounter(limits.ipFailWindowMs, limits.maxKeys);
  }

  /** 시도 직전에 부른다. 허용되면 계정별 연타 카운트를 1 올린다. */
  check(ip: string, email: string | undefined): LoginGuardVerdict {
    const now = this.now();
    const emailKey = normalizeEmail(email);

    const ipFails = this.ipFail.count(ip, now);
    if (ipFails.length >= this.limits.ipFailMax) {
      return { ok: false, scope: 'IP_FAILURES', retryAfterMs: this.ipFail.retryAfter(ipFails, now) };
    }
    if (emailKey) {
      const fails = this.emailFail.count(emailKey, now);
      if (fails.length >= this.limits.emailFailMax) {
        return { ok: false, scope: 'EMAIL_FAILURES', retryAfterMs: this.emailFail.retryAfter(fails, now) };
      }
      const burst = this.emailBurst.count(emailKey, now);
      if (burst.length >= this.limits.emailBurstMax) {
        return { ok: false, scope: 'EMAIL_BURST', retryAfterMs: this.emailBurst.retryAfter(burst, now) };
      }
      this.emailBurst.add(emailKey, now);
    }
    return { ok: true };
  }

  /** 자격 불일치(미등록·PIN 불일치·형식 오류)일 때만 부른다. 시트·DB 장애는 회원 잘못이 아니므로 세지 않는다. */
  recordFailure(ip: string, email: string | undefined): void {
    const now = this.now();
    this.ipFail.add(ip, now);
    const emailKey = normalizeEmail(email);
    if (emailKey) this.emailFail.add(emailKey, now);
  }
}

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '';
}
