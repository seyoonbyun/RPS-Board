// 가장 간단한 구글 시트 업데이트 테스트
import { google } from 'googleapis';

async function simpleTest() {
  console.log('=== 단순 직접 테스트 시작 ===');
  
  try {
    // 서비스 어카운트 인증
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg';

    // 1. 현재 G2 값 읽기
    console.log('1단계: 현재 G2 값 읽기...');
    const readResult = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'RPS!G2:G2',
    });
    const currentValue = readResult.data.values?.[0]?.[0] || 'EMPTY';
    console.log('현재 G2 값:', currentValue);

    // 2. 새로운 값으로 업데이트
    const newValue = `SIMPLE_TEST_${Date.now()}`;
    console.log('2단계: 새로운 값으로 업데이트...', newValue);
    
    const updateResult = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'RPS!G2:G2',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[newValue]]
      }
    });
    console.log('업데이트 결과:', updateResult.data);

    // 3. 즉시 다시 읽기
    console.log('3단계: 업데이트 후 즉시 다시 읽기...');
    const verifyResult = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'RPS!G2:G2',
    });
    const verifyValue = verifyResult.data.values?.[0]?.[0] || 'EMPTY';
    console.log('검증 값:', verifyValue);

    // 4. 결과 비교
    console.log('=== 결과 분석 ===');
    console.log('보낸 값:', newValue);
    console.log('받은 값:', verifyValue);
    console.log('일치:', newValue === verifyValue ? '✅ 성공' : '❌ 실패');

  } catch (error) {
    console.error('❌ 에러:', error.message);
  }
}

simpleTest();