import express, { type Request, Response, NextFunction, type Express } from "express";
import path from "path";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import { log, serveStatic } from "./prod-static";
import { initializeGoogleSheets } from "./google-sheets";
import { NETWORK_CONFIG, SHEETS_CONFIG } from "@shared/constants";

export async function createApp(): Promise<{ app: Express; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith("/api")) {
        let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }
        log(logLine);
      }
    });

    next();
  });

  console.log('🚀 Starting BNI Korea RPS System...');

  const requiredEnvVars = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  ];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName] && !process.env[varName + '_NEW']);
  if (missingVars.length > 0) {
    console.warn('⚠️ Missing environment variables:', missingVars.join(', '));
    console.warn('⚠️ Google Sheets functionality may be limited');
  }

  let serviceAccountEmail = '';
  let serviceAccountPrivateKey = '';

  const newEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_NEW || '';
  const newKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_NEW || '';
  const oldEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const oldKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';

  if (newEmail.includes('@') && !newEmail.includes('BEGIN PRIVATE KEY')) {
    serviceAccountEmail = newEmail;
  } else if (newKey.includes('@') && !newKey.includes('BEGIN PRIVATE KEY')) {
    serviceAccountEmail = newKey;
  } else {
    serviceAccountEmail = oldEmail;
  }

  if (newKey.includes('BEGIN PRIVATE KEY')) {
    serviceAccountPrivateKey = newKey;
  } else if (newEmail.includes('BEGIN PRIVATE KEY')) {
    serviceAccountPrivateKey = newEmail;
  } else {
    serviceAccountPrivateKey = oldKey;
  }

  console.log('📧 Using service account email:', serviceAccountEmail || 'NOT SET');
  console.log('🔑 Private key configured:', serviceAccountPrivateKey ? 'YES' : 'NO');

  try {
    if (!serviceAccountEmail || !serviceAccountPrivateKey) {
      throw new Error('Google Sheets credentials not configured');
    }
    initializeGoogleSheets({
      apiKey: process.env.GOOGLE_SHEETS_API_KEY || '',
      spreadsheetId: process.env.GOOGLE_SHEETS_ID || SHEETS_CONFIG.SPREADSHEET_ID,
      serviceAccountEmail: serviceAccountEmail,
      serviceAccountPrivateKey: serviceAccountPrivateKey
    });
    console.log('✅ Google Sheets service initialized successfully');
  } catch (error) {
    console.error('❌ Google Sheets initialization error:', error);
    console.warn('⚠️ Server will continue without Google Sheets - some features may be limited');
  }

  const attachedAssetsDir = process.env.VERCEL
    ? path.resolve(process.cwd(), 'attached_assets')
    : path.resolve(import.meta.dirname, '..', 'attached_assets');
  app.use('/attached_assets', express.static(attachedAssetsDir));

  const server = await registerRoutes(app);
  console.log('Routes registered successfully');

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error('Express error:', err);
    res.status(status).json({ message });
  });

  // Frontend serving:
  // - Vercel: skip (Vercel's CDN serves dist/public directly)
  // - Local dev: attach Vite middleware (dynamic import keeps vite out of prod bundles)
  // - Local prod / other hosts: serve built dist/public
  if (process.env.VERCEL) {
    // no-op
  } else if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
    console.log('Vite setup completed');
  } else {
    serveStatic(app);
  }

  return { app, server };
}

// Standalone entry point — used for local dev (tsx) and traditional Node hosting.
// Skipped on Vercel, where api/index.ts imports createApp() instead.
if (!process.env.VERCEL) {
  (async () => {
    try {
      const { server } = await createApp();
      const port = parseInt(process.env.PORT || NETWORK_CONFIG.DEFAULT_PORT.toString(), 10);
      const host = process.env.HOST || (process.platform === "win32" ? "127.0.0.1" : "0.0.0.0");
      const listenOpts: { port: number; host: string; reusePort?: boolean } = { port, host };
      if (process.platform !== "win32") listenOpts.reusePort = true;
      server.listen(listenOpts, () => {
        log(`serving on ${host}:${port}`);
      });
    } catch (error) {
      console.error('Server startup error:', error);
      process.exit(1);
    }
  })();
}
