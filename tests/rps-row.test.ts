import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsService } from '../api/_lib/google-sheets.js';
import { buildRpsUpdateRow } from '../api/_lib/rps-row.js';

const existing = ['A@x.invalid', '서울', '챕터1', '홍길동', '시트업종', '시트회사', 'old', 'old',
  '', '', '', '', '', '', '', '', '', '', '', '', '0', '0%', 'A@x.invalid', '0007', '활동중', 'Member'];

const cases: any[] = [
  { userEmail: 'a@x.invalid', region: '앱지역', partner: '앱챕터', memberName: '앱이름', industry: '', company: '앱회사',
    specialty: '세무', targetCustomer: '중소기업', rpartner1: '김', rpartner1Specialty: '노무', rpartner1Stage: 'P',
    rpartner2: '이', rpartner2Specialty: '법무', rpartner2Stage: 'Credibility : 신뢰단계', rpartner3: ' ', rpartner3Stage: 'P' },
  { userEmail: 'a@x.invalid', specialty: '', rpartner4: '박', rpartner4Stage: 'Profit : 수익단계' },
];

test('묶음 쓰기 행 = 기존 한 명씩 쓰기(syncScoreboardData)가 시트에 보내던 행', async () => {
  for (const data of cases) {
    const svc: any = new GoogleSheetsService({ apiKey: '', spreadsheetId: 's', serviceAccountEmail: 'e', serviceAccountPrivateKey: 'k' } as any);
    svc.getAccessToken = async () => 't';
    svc.getCachedFullSheet = async () => [['이메일'], existing];
    svc.invalidateCache = () => {};
    let sent: any = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'PUT') sent = JSON.parse(init.body).values[0];
      return new Response(JSON.stringify({ values: [[sent?.[6] ?? '']] }), { status: 200 });
    }) as any;
    try {
      await svc.syncScoreboardData(data);
    } finally {
      globalThis.fetch = realFetch;
    }
    const built = buildRpsUpdateRow(data, existing, (s: string) => svc.normalizeStage(s));
    assert.deepEqual(built, sent);
  }
});
