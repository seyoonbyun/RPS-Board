import { initializeGoogleSheets, getGoogleSheetsService } from "./_lib/google-sheets.js";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
  if (email && key) {
    initializeGoogleSheets({
      apiKey: process.env.GOOGLE_SHEETS_API_KEY || "",
      spreadsheetId: process.env.GOOGLE_SHEETS_ID || "",
      serviceAccountEmail: email,
      serviceAccountPrivateKey: key,
    });
    initialized = true;
    // 콜드 스타트 시 사용자 인덱스 프리워밍 (첫 요청이 800명 × O(1) 조회 감당)
    const svc = getGoogleSheetsService();
    if (svc) {
      svc.getCachedUserIndex('warmup').catch((err: any) =>
        console.warn('Warmup getCachedUserIndex failed:', err?.message || err),
      );
    }
  }
}

export default async function handler(req: any, res: any) {
  ensureInit();
  const url: string = req.url || "";

  // /api/diag 제거됨 (2026-08-28).
  // 인증 없이 열려 있으면서 시트 첫 행의 **실제 회원 이메일과 4자리 비밀번호를 평문으로**
  // 반환하고 있었다. 진단이 필요하면 관리자 인증이 걸린 /api/admin/* 로 만든다.

  // Full Express app
  try {
    const { createApp } = await import("./_lib/app.js");
    const { app } = await createApp();
    return app(req, res);
  } catch (err: any) {
    return res.status(500).json({ error: "App init failed", message: err.message });
  }
}
