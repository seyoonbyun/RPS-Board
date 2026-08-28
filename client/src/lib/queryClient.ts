import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // 서버가 { code, message } 를 준다. 그걸 버리고 상태코드만 보여주면
    // 화면에는 또 '원인 모를 실패'만 남는다.
    let message = text;
    let code: string | undefined;
    try {
      const body = JSON.parse(text);
      if (body?.message) message = body.message;
      if (body?.code) code = body.code;
    } catch {
      /* JSON 이 아닌 응답(프록시 오류 등) */
    }
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = code;
    throw err;
  }
}

function getStoredEmail(): string | null {
  try {
    const saved = localStorage.getItem('bni_user');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return parsed?.email || null;
  } catch {
    return null;
  }
}

// fetch() 래퍼: 저장된 사용자 이메일을 x-caller-email 헤더로 자동 첨부
// 서버 requireAdmin 미들웨어가 이 헤더로 호출자 권한을 검증함
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const callerEmail = getStoredEmail();
  const mergedHeaders = new Headers(init?.headers);
  if (callerEmail && !mergedHeaders.has('x-caller-email')) {
    mergedHeaders.set('x-caller-email', callerEmail);
  }
  return fetch(input, { ...init, headers: mergedHeaders, credentials: init?.credentials ?? 'include' });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers['Content-Type'] = 'application/json';
  const callerEmail = getStoredEmail();
  if (callerEmail) headers['x-caller-email'] = callerEmail;

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    const callerEmail = getStoredEmail();
    if (callerEmail) headers['x-caller-email'] = callerEmail;
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
