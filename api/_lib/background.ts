/**
 * 응답을 기다리게 하지 않고 뒤에서 끝낼 일. Vercel 에서는 waitUntil 로 함수가 그 일을 마칠 때까지 살려 두고,
 * 로컬에서는 그냥 돌게 둔다. 실패는 호출한 쪽이 이미 잡아 둔 상태여야 한다.
 */
export function runInBackground(p: Promise<unknown>): void {
  import('@vercel/functions')
    .then((m: any) => m.waitUntil?.(p))
    .catch(() => {});
}
