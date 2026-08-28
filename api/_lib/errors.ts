/**
 * 실패를 값으로 바꿔치기하지 않기 위한 오류 타입.
 *
 * 근본 원인이 된 패턴: 시트 읽기가 터졌을 때 `catch { return false }` 로 삼키면
 * **"조회 실패"와 "데이터에 없음"이 같은 값**이 된다. 그 결과 로그인에서는
 * 구글시트 429 하나가 회원에게 "등록되지 않은 회원입니다"로 둔갑했다.
 * 부재는 정상 흐름의 반환값으로, 장애는 예외로 — 둘을 절대 섞지 않는다.
 */
export class SheetUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'SHEET_UNAVAILABLE';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SheetUnavailableError';
    this.cause = cause;
  }
}

/** 탈퇴 회원. 인증 실패(403)와 구분해 안내 문구를 다르게 준다. */
export class WithdrawnUserError extends Error {
  readonly status = 403;
  readonly code = 'WITHDRAWN';

  constructor(email: string) {
    super(`withdrawn user: ${email}`);
    this.name = 'WithdrawnUserError';
  }
}

/** catch 안에서 호출: 이미 분류된 오류는 그대로, 아니면 시트 장애로 승격시켜 다시 던진다. */
export function rethrowAsSheetError(where: string, err: unknown): never {
  if (err instanceof SheetUnavailableError) throw err;
  if (err instanceof WithdrawnUserError) throw err;
  const msg = (err as any)?.message ?? String(err);
  throw new SheetUnavailableError(`${where}: ${msg}`, err);
}

/** HTTP 경계에서 한 번만 해석한다. */
export function httpErrorOf(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof SheetUnavailableError) {
    return {
      status: 503,
      code: 'SHEET_UNAVAILABLE',
      message: '지금 회원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
    };
  }
  if (err instanceof WithdrawnUserError) {
    return { status: 403, code: 'WITHDRAWN', message: '탈퇴한 계정입니다. 관리자에게 계정 복구를 요청하세요.' };
  }
  return { status: 500, code: 'INTERNAL', message: '처리 중 오류가 발생했습니다.' };
}
