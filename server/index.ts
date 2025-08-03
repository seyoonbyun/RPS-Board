import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeGoogleSheets } from "./google-sheets";

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
  
  console.log('Using service account email:', serviceAccountEmail);
  console.log('Private key starts with:', serviceAccountPrivateKey.substring(0, 50) + '...');
  
  initializeGoogleSheets({
    apiKey: process.env.GOOGLE_SHEETS_API_KEY || '',
    spreadsheetId: '1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg', // Direct spreadsheet ID
    serviceAccountEmail: serviceAccountEmail,
    serviceAccountPrivateKey: serviceAccountPrivateKey
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
