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
  }
}

export default async function handler(req: any, res: any) {
  ensureInit();
  const url: string = req.url || "";

  if (url.includes("/api/diag")) {
    const svc = getGoogleSheetsService();
    if (!svc) return res.status(500).json({ error: "no sheets service" });

    try {
      // Use existing service methods
      const adminCheck = await svc.checkAdminSheetCredentials("joy.byun@bnikorea.com", "1234");
      const userCheck = await svc.checkUserCredentials("joy.byun@bnikorea.com", "1234");

      let allUsers: any = null;
      let allUsersError: string | null = null;
      try {
        allUsers = await svc.getAllUsers();
        allUsers = allUsers?.slice(0, 3); // first 3 users only
      } catch (e: any) {
        allUsersError = e.message;
      }

      let userProfile: any = null;
      let profileError: string | null = null;
      try {
        userProfile = await svc.getUserProfile("joy.byun@bnikorea.com");
      } catch (e: any) {
        profileError = e.message;
      }

      return res.status(200).json({
        ok: true,
        adminCheck,
        userCheck,
        allUsers,
        allUsersError,
        userProfile,
        profileError,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
    }
  }

  // Default: forward to Express app
  try {
    const { createApp } = await import("./_lib/app.js");
    const { app } = await createApp();
    return app(req, res);
  } catch (err: any) {
    return res.status(500).json({ error: "App init failed", message: err.message });
  }
}
