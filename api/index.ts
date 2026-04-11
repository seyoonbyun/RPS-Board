import { initializeGoogleSheets, getGoogleSheetsService } from "./_lib/google-sheets";

let initialized = false;
let initError: string | null = null;

function ensureInit() {
  if (initialized) return;
  try {
    const email =
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_NEW ||
      "";
    const key =
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_NEW ||
      "";
    if (!email || !key) {
      throw new Error(
        `Missing credentials (email=${!!email}, key=${!!key})`
      );
    }
    initializeGoogleSheets({
      apiKey: process.env.GOOGLE_SHEETS_API_KEY || "",
      spreadsheetId: process.env.GOOGLE_SHEETS_ID || "",
      serviceAccountEmail: email,
      serviceAccountPrivateKey: key,
    });
    initialized = true;
  } catch (err: any) {
    initError = err?.message || String(err);
  }
}

export default async function handler(req: any, res: any) {
  ensureInit();

  const envReport = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SHEETS_API_KEY: !!process.env.GOOGLE_SHEETS_API_KEY,
    GOOGLE_SHEETS_ID: !!process.env.GOOGLE_SHEETS_ID,
    DATABASE_URL: !!process.env.DATABASE_URL,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    NAVER_CLIENT_ID: !!process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: !!process.env.NAVER_CLIENT_SECRET,
  };

  res.status(200).json({
    ok: true,
    step: "1 — google-sheets import test",
    url: req.url,
    method: req.method,
    initialized,
    initError,
    sheetsServiceReady: !!getGoogleSheetsService(),
    env: envReport,
    now: new Date().toISOString(),
  });
}
