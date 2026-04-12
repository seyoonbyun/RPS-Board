import { initializeGoogleSheets, getGoogleSheetsService } from "./_lib/google-sheets.js";
import jwt from "jsonwebtoken";

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

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
  privateKey = privateKey.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const assertion = jwt.sign(payload, privateKey, { algorithm: "RS256" });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  const data = await resp.json();
  return data.access_token;
}

export default async function handler(req: any, res: any) {
  ensureInit();
  const url: string = req.url || "";

  if (url.includes("/api/diag")) {
    try {
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "";
      const token = await getAccessToken();

      // Get spreadsheet metadata (sheet names)
      const metaResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?access_token=${token}&fields=sheets.properties.title`
      );
      const meta = await metaResp.json();
      const sheetNames = (meta.sheets || []).map((s: any) => s.properties.title);

      // Read first 3 rows of each sheet
      const previews: Record<string, any> = {};
      for (const name of sheetNames.slice(0, 5)) {
        const r = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(name)}!A1:Z3?access_token=${token}`
        );
        const d = await r.json();
        previews[name] = d.values || [];
      }

      return res.status(200).json({
        ok: true,
        spreadsheetId,
        sheetNames,
        previews,
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
