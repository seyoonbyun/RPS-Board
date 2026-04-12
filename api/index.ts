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
      // Read RPS sheet headers + first 2 data rows
      const rows = await svc.readSheetRange("RPS", "A1:Z3");
      const headers = rows[0] || [];
      const idCol = headers.findIndex((h: string) => h?.toString().trim().toUpperCase() === "ID");
      const pwCol = headers.findIndex((h: string) => h?.toString().trim().toUpperCase() === "PW");

      // Get first member's real credentials
      let testEmail = "";
      let testPw = "";
      if (idCol >= 0 && pwCol >= 0 && rows.length > 1) {
        testEmail = rows[1][idCol]?.toString().trim() || "";
        testPw = rows[1][pwCol]?.toString().trim() || "";
      }

      // Login test with real credentials from sheet
      let loginResult: any = null;
      let profileResult: any = null;
      let scoreboardResult: any = null;
      if (testEmail && testPw) {
        const userCheck = await svc.checkUserCredentials(testEmail, testPw);
        loginResult = { email: testEmail, pw: testPw, valid: userCheck };

        if (userCheck) {
          // Test profile fetch
          try {
            profileResult = await svc.getUserProfile(testEmail);
          } catch (e: any) {
            profileResult = { error: e.message };
          }
        }
      }

      return res.status(200).json({
        ok: true,
        headers: headers.slice(0, 10),
        idCol,
        pwCol,
        testLogin: loginResult,
        profile: profileResult,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Full Express app
  try {
    const { createApp } = await import("./_lib/app.js");
    const { app } = await createApp();
    return app(req, res);
  } catch (err: any) {
    return res.status(500).json({ error: "App init failed", message: err.message });
  }
}
