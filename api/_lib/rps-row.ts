import { SHEET_COLUMN_INDICES, BUSINESS_CONFIG } from './constants.js';

/**
 * 기존 회원 행(A~Y) 하나를 만든다 — google-sheets.ts syncScoreboardData 의 '기존 행 갱신' 규칙을 그대로 옮긴 것.
 * 여러 회원의 저장을 시트에 한 번에 쓰기(batchUpdate) 위해 순수 함수로 뗐다.
 *  - 지역·챕터·멤버명: 시트 값 우선
 *  - 산업군·회사: 앱 값 우선(비었으면 시트 값)
 *  - 전문분야·고객층·R파트너: 앱 값
 *  - U/V: 다시 계산, W: 이메일, X(PW)·Y(STATUS): 시트 값 유지
 */
export function buildRpsUpdateRow(
  data: any,
  existingRow: any[],
  normalizeStage: (s: string) => string,
): string[] {
  const values: string[] = [
    data.userEmail,
    data.region || '',
    data.partner || '',
    data.memberName || '',
    data.industry || '',
    data.company || '',
    data.specialty || '',
    data.targetCustomer || '',
    data.rpartner1 || '',
    data.rpartner1Specialty || '',
    normalizeStage(data.rpartner1Stage || ''),
    data.rpartner2 || '',
    data.rpartner2Specialty || '',
    normalizeStage(data.rpartner2Stage || ''),
    data.rpartner3 || '',
    data.rpartner3Specialty || '',
    normalizeStage(data.rpartner3Stage || ''),
    data.rpartner4 || '',
    data.rpartner4Specialty || '',
    normalizeStage(data.rpartner4Stage || ''),
  ];

  values[0] = existingRow[0] || data.userEmail;
  values[1] = existingRow[1] || data.region || '';
  values[2] = existingRow[2] || data.partner || '';
  values[3] = existingRow[3] || data.memberName || '';
  values[4] = data.industry || existingRow[4] || '';
  values[5] = data.company || existingRow[5] || '';

  const partners = [
    { name: data.rpartner1, stage: data.rpartner1Stage },
    { name: data.rpartner2, stage: data.rpartner2Stage },
    { name: data.rpartner3, stage: data.rpartner3Stage },
    { name: data.rpartner4, stage: data.rpartner4Stage },
  ];
  const profit = partners.filter((p) => p.name && p.name.trim() !== '' && p.stage?.includes('Profit')).length;
  const achievement = Math.round((profit / BUSINESS_CONFIG.PARTNER_TARGET) * 100);
  values[20] = profit.toString();
  values[21] = `${achievement}%`;
  values[22] = data.userEmail;

  let existingPW = existingRow[SHEET_COLUMN_INDICES.PASSWORD] ? existingRow[SHEET_COLUMN_INDICES.PASSWORD].toString().trim() : '';
  const existingStatus = existingRow[SHEET_COLUMN_INDICES.STATUS] ? existingRow[SHEET_COLUMN_INDICES.STATUS] : '활동중';
  if (!existingPW && data.userEmail === 'joy.byun@bnikorea.com') existingPW = '1234';
  values[SHEET_COLUMN_INDICES.PASSWORD] = existingPW;
  values[SHEET_COLUMN_INDICES.STATUS] = existingStatus;
  return values;
}
