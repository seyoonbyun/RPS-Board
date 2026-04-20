#!/usr/bin/env node
// 과거 USER_ENTERED 버그로 앞자리 0이 손실된 PW 값들을
// RPS!X열과 Auth!D열에서 4자리 문자열로 일괄 복구한다.
// - 1~3자리 숫자만 있는 셀을 padStart(4,'0')
// - 이미 4자리면 스킵
// - 4자리 초과, 숫자 아닌 값은 경고만
// RAW + 이미 적용된 TEXT numberFormat 덕분에 재발 없음.

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
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
await jwt.authorize();
const sheets = google.sheets({ version: 'v4', auth: jwt });
const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

const DRY = process.argv.includes('--dry');

async function backfillColumn(sheet, columnLetter, emailColumnLetter) {
  const range = `${sheet}!${emailColumnLetter}:${columnLetter}`;
  // emailColumnLetter는 "A" 또는 "C", PW는 X 또는 D
  // 단순하게 전체 시트를 읽자
  const fullRange = sheet === 'RPS' ? 'A1:Z5000' : 'A1:E200';
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!${fullRange}` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return { updated: 0, warned: 0 };

  // PW 컬럼 인덱스
  const pwCol = columnLetter === 'X' ? 23 : 3;
  const emailCol = emailColumnLetter === 'A' ? 0 : 2;

  const updates = [];
  const warnings = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const raw = (row[pwCol] ?? '').toString().trim();
    if (!raw) continue;
    if (/^\d{4}$/.test(raw)) continue;
    if (/^\d{1,3}$/.test(raw)) {
      const padded = raw.padStart(4, '0');
      updates.push({ rowIdx: i + 1, email: row[emailCol] || '(no email)', from: raw, to: padded });
    } else {
      warnings.push({ rowIdx: i + 1, email: row[emailCol] || '(no email)', raw });
    }
  }

  console.log(`\n=== ${sheet}!${columnLetter} (PW) ===`);
  console.log(`업데이트 대상: ${updates.length}건, 경고(수동 확인 필요): ${warnings.length}건`);
  for (const u of updates) console.log(`  ✎ ${sheet}!${columnLetter}${u.rowIdx} ${u.email}: "${u.from}" → "${u.to}"`);
  for (const w of warnings) console.log(`  ⚠️ ${sheet}!${columnLetter}${w.rowIdx} ${w.email}: "${w.raw}" (4자리 숫자 아님 — 수동 확인)`);

  if (DRY || updates.length === 0) return { updated: 0, warned: warnings.length };

  // batchUpdate — 각 셀마다 하나의 range
  const data = updates.map(u => ({
    range: `${sheet}!${columnLetter}${u.rowIdx}`,
    values: [[u.to]]
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data }
  });
  console.log(`✅ ${updates.length}건 업데이트 완료 (RAW + TEXT 포맷 덕분에 앞자리 0 보존)`);
  return { updated: updates.length, warned: warnings.length };
}

console.log(DRY ? '[DRY RUN — 실제 쓰기 없음]' : '[실제 적용]');
const rps = await backfillColumn('RPS', 'X', 'A');
const auth = await backfillColumn('Auth', 'D', 'C');
console.log(`\n합계: 업데이트 ${rps.updated + auth.updated}건, 경고 ${rps.warned + auth.warned}건`);
