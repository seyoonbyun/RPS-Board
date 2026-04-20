#!/usr/bin/env node
// RPS Board 데이터 불변식 audit
// 사용: `node scripts/audit-invariants.mjs`
// docs/permissions.md 에 정의된 규칙을 검사하고 위반 사항을 보고한다.
//
// 검사 항목:
//   [A1] Auth 시트 AUTH열은 관리자 tier { Admin, National, Growth } 중 하나
//   [A2] Auth 시트 이메일 중복 금지
//   [R1] RPS 시트 Z열은 { National, Admin, Growth, Member } 중 하나
//   [R2] RPS 시트 X열(PW)은 4자리 문자열이어야 한다
//   [S1] Auth에 있는 이메일은 RPS에도 존재해야 한다
//   [S2] Auth 이메일의 RPS Z열은 { National, Admin, Growth } 중 하나 (Member 아님)

import { readFileSync } from 'fs';
import { google } from 'googleapis';

const env = readFileSync('.env', 'utf-8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const jwt = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
await jwt.authorize();
const sheets = google.sheets({ version: 'v4', auth: jwt });
const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

const ADMIN_TIERS = new Set(['National', 'Admin', 'Growth']);
const ALL_AUTH = new Set(['National', 'Admin', 'Growth', 'Member']);
const violations = [];
const record = (code, detail) => violations.push({ code, detail });

// 데이터 로드
const [authRes, rpsRes] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId, range: 'Auth!A1:E200' }),
  sheets.spreadsheets.values.get({ spreadsheetId, range: 'RPS!A1:Z5000' }),
]);
const authRows = authRes.data.values || [];
const rpsRows = rpsRes.data.values || [];

// RPS: email → {row, z열}
const rpsByEmail = new Map();
for (let i = 1; i < rpsRows.length; i++) {
  const e = rpsRows[i][0]?.toString().trim().toLowerCase();
  if (e) rpsByEmail.set(e, { row: i + 1, auth: (rpsRows[i][25] || '').toString().trim(), pw: (rpsRows[i][23] ?? '').toString() });
}

// [A1] Auth AUTH=관리자 tier (Admin/National/Growth)
for (let i = 1; i < authRows.length; i++) {
  const r = authRows[i];
  if (!r[2]) continue;
  const z = (r[4] || '').toString().trim();
  if (!ADMIN_TIERS.has(z)) {
    record('A1', `Auth!행${i+1} ${r[2]} AUTH="${z || '(빈값)'}" (Admin/National/Growth 중 하나여야 함)`);
  }
}

// [A2] Auth 이메일 중복
const authEmailCount = new Map();
for (let i = 1; i < authRows.length; i++) {
  const e = authRows[i][2]?.toString().trim().toLowerCase();
  if (!e) continue;
  authEmailCount.set(e, (authEmailCount.get(e) || 0) + 1);
}
for (const [e, c] of authEmailCount) if (c > 1) record('A2', `Auth 시트 ${e}: ${c}건 중복`);

// [R1] RPS Z열 값
for (const [e, info] of rpsByEmail) {
  const z = info.auth;
  if (!z) record('R1', `RPS!행${info.row} ${e} Z열 비어있음`);
  else if (!ALL_AUTH.has(z)) record('R1', `RPS!행${info.row} ${e} Z열="${z}" (허용값 외)`);
}

// [R2] RPS X열(PW) 4자리 문자열
for (const [e, info] of rpsByEmail) {
  const pw = info.pw;
  if (!pw) continue; // 빈 값은 [R2]에서 스킵 — 별도 체크 가능하지만 현재는 허용
  if (!/^\d{4}$/.test(pw)) record('R2', `RPS!행${info.row} ${e} PW="${pw}" (4자리 숫자 문자열 아님)`);
}

// [S1] Auth 이메일은 RPS에 존재
const authAdminEmails = new Set();
for (let i = 1; i < authRows.length; i++) {
  const e = authRows[i][2]?.toString().trim().toLowerCase();
  if (e) authAdminEmails.add(e);
}
for (const e of authAdminEmails) {
  if (!rpsByEmail.has(e)) record('S1', `Auth에 있는 ${e}가 RPS 시트에 없음`);
}

// [S2] Auth 이메일의 RPS Z열 = admin-tier
for (const e of authAdminEmails) {
  const info = rpsByEmail.get(e);
  if (!info) continue; // [S1]에서 이미 보고
  if (!ADMIN_TIERS.has(info.auth)) {
    record('S2', `${e}: Auth=Admin 인데 RPS!Z${info.row}="${info.auth}" (관리자 tier 아님)`);
  }
}

// 결과 출력
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`RPS Board 데이터 불변식 audit`);
console.log(`Auth 행: ${authRows.length - 1}, RPS 멤버: ${rpsByEmail.size}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (violations.length === 0) {
  console.log('✅ 모든 규칙 통과');
  process.exit(0);
}
const byCode = {};
for (const v of violations) { byCode[v.code] ??= []; byCode[v.code].push(v.detail); }
for (const [code, items] of Object.entries(byCode).sort()) {
  console.log(`\n[${code}] ${items.length}건:`);
  for (const d of items) console.log(`  - ${d}`);
}
console.log(`\n총 위반: ${violations.length}건`);
process.exit(1);
