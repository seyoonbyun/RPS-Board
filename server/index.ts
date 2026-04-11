import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeGoogleSheets } from "./google-sheets";
import { NETWORK_CONFIG, SHEETS_CONFIG } from "@shared/constants";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
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

(async () => {
  try {
    console.log('🚀 Starting BNI Korea RPS System...');
    
    // Validate critical environment variables
    const requiredEnvVars = [
      'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName] && !process.env[varName + '_NEW']);
    
    if (missingVars.length > 0) {
      console.warn('⚠️ Missing environment variables:', missingVars.join(', '));
      console.warn('⚠️ Google Sheets functionality may be limited');
    }
    
    // Initialize Google Sheets service with new credentials if available
    // Check which credentials to use based on what looks like email vs private key
    let serviceAccountEmail = '';
    let serviceAccountPrivateKey = '';
    
    // Determine which env var contains email vs private key
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
    
    // Initialize Google Sheets service with graceful fallback
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
      // Continue startup even if Google Sheets fails - server will still respond to health checks
    }

    // Serve static files for Open Graph images
    app.use('/attached_assets', express.static(path.resolve(import.meta.dirname, '..', 'attached_assets')));

    // Register routes with error handling
    const server = await registerRoutes(app);
    console.log('Routes registered successfully');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      console.error('Express error:', err);
      res.status(status).json({ message });
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
      console.log('Vite setup completed');
    } else {
      serveStatic(app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
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
