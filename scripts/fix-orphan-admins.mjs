#!/usr/bin/env node
// Auth 시트에는 있지만 RPS 시트에 없는 관리자들을 RPS에 보충.
// 이들은 현재 로그인 불가 상태이므로 즉시 조치 필요.
// RPS에 A-Z 26열 전체를 채워 신규 행으로 append하고 Z열(AUTH)은 Auth 시트의 값을 그대로 복사.
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

// 1. Auth와 RPS 읽기
const [authR, rpsR] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId, range: 'Auth!A1:E200' }),
  sheets.spreadsheets.values.get({ spreadsheetId, range: 'RPS!A1:Z5000' }),
]);
const authRows = authR.data.values || [];
const rpsRows = rpsR.data.values || [];
const rpsEmails = new Set(rpsRows.slice(1).map(r => r[0]?.toString().trim().toLowerCase()).filter(Boolean));

// 2. Auth에 있지만 RPS에 없는 관리자 찾기
const orphans = [];
for (let i = 1; i < authRows.length; i++) {
  const r = authRows[i];
  const email = r[2]?.toString().trim().toLowerCase();
  if (!email) continue;
  if (rpsEmails.has(email)) continue;
  orphans.push({
    region: r[0]?.toString().trim() || '',
    memberName: r[1]?.toString().trim() || '',
    email: r[2]?.toString().trim() || '',
    password: (r[3] ?? '').toString().trim().padStart(4, '0'),
    auth: r[4]?.toString().trim() || 'Admin',
  });
}

console.log(`=== RPS에 없는 Auth 관리자: ${orphans.length}명 ===`);
if (orphans.length === 0) { console.log('처리할 대상 없음'); process.exit(0); }
for (const o of orphans) console.log(`  ${o.email} (${o.memberName}, ${o.region}, pw=${o.password}, auth=${o.auth})`);

// 3. 각각 RPS에 신규 행으로 append. RPS 스키마: 26열(A-Z), Z열은 AUTH.
const newRows = orphans.map(o => [
  o.email,          // A 이메일
  o.region,         // B 지역
  '',               // C 챕터 (Auth 시트에는 챕터 필드 없음 — 빈 값)
  o.memberName,     // D 멤버명
  '',               // E 산업군
  '',               // F 회사
  '',               // G 전문분야
  '',               // H 핵심 고객층
  '', '', '',       // I-K R파트너 1
  '', '', '',       // L-N R파트너 2
  '', '', '',       // O-Q R파트너 3
  '', '', '',       // R-T R파트너 4
  '0',              // U 총 R파트너 수
  '0%',             // V 달성
  o.email,          // W ID
  o.password,       // X PW
  '활동중',         // Y STATUS
  o.auth,           // Z AUTH
]);

console.log(`\nRPS에 ${newRows.length}개 행 append 중...`);
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: 'RPS!A:Z',
  valueInputOption: 'RAW',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: newRows }
});
console.log(`✅ ${newRows.length}명 RPS 보충 완료 — 이제 로그인 가능`);

// 4. 검증
const verify = (await sheets.spreadsheets.values.get({ spreadsheetId, range: 'RPS!A1:Z5000' })).data.values || [];
for (const o of orphans) {
  const row = verify.find((r, i) => i > 0 && r[0]?.toString().trim().toLowerCase() === o.email.toLowerCase());
  if (row) console.log(`  ✓ ${o.email}: Z열(AUTH)=${row[25]}, X열(PW)=${row[23]}`);
  else console.log(`  ✗ ${o.email}: 검증 실패 — 수동 확인 필요`);
}
