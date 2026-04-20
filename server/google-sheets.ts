// Single source of truth: api/_lib/google-sheets.ts
// Historically server/ and api/_lib/ drifted (caused the 5-col vs 27-col
// WithdrawalHistory bug). This thin re-export keeps local dev (tsx) and
// Vercel serverless (api/index.ts) on identical logic.
export * from '../api/_lib/google-sheets.js';
