// Single source of truth: shared/constants.ts
// This re-export file prevents api/_lib/ vs shared/ drift — both Vercel
// (api/index.ts) and local dev (server/index.ts) resolve the same symbols.
export * from '../../shared/constants.js';
