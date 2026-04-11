import { initializeGoogleSheets, getGoogleSheetsService } from "./_lib/google-sheets.js";

let initialized = false;
let initError: string | null = null;

function ensureInit() {
  if (initialized) return;
  try {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
    if (!email || !key) {
      throw new Error(`Missing credentials (email=${!!email}, key=${!!key})`);
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

export default function handler(req: any, res: any) {
  ensureInit();

  const envReport = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SHEETS_API_KEY: !!process.env.GOOGLE_SHEETS_API_KEY,
    GOOGLE_SHEETS_ID: !!process.env.GOOGLE_SHEETS_ID,
    DATABASE_URL: !!process.env.DATABASE_URL,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  };

  res.status(200).json({
    ok: true,
    step: "2 — google-sheets only",
    url: req.url,
    method: req.method,
    initialized,
    initError,
    sheetsServiceReady: !!getGoogleSheetsService(),
    env: envReport,
    now: new Date().toISOString(),
  });
}
