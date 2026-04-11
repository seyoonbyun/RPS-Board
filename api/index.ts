import { BUSINESS_CONFIG, API_RATE_LIMITS } from "./_lib/constants";

export default function handler(req: any, res: any) {
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
    step: "1a — constants only",
    url: req.url,
    method: req.method,
    constantsOk: !!BUSINESS_CONFIG && !!API_RATE_LIMITS,
    env: envReport,
    now: new Date().toISOString(),
  });
}
