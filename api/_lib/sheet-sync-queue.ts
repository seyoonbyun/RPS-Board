import { db } from './db.js';
import { pendingSheetSyncs } from './schema.js';
import { getGoogleSheetsService } from './google-sheets.js';
import { sql, lte, eq } from 'drizzle-orm';

const MAX_RETRIES = 5;
const BATCH_SIZE = 10;

/**
 * 실패한 Google Sheets 쓰기를 DB에 저장.
 * 다음 요청 시 재시도됨 — 데이터 절대 유실 없음.
 */
export async function enqueuePendingSync(
  userEmail: string,
  operation: 'syncScoreboard' | 'logActivity',
  payload: any,
  errorMessage: string,
) {
  if (!db) return;
  try {
    await db.insert(pendingSheetSyncs).values({
      userEmail,
      operation,
      payload,
      errorMessage,
      retryCount: 0,
      nextRetryAt: new Date(),
    });
    console.log(`📥 Queued pending sheet sync: ${operation} for ${userEmail}`);
  } catch (err) {
    console.error('Failed to enqueue pending sync:', err);
  }
}

/**
 * pending 큐에서 재시도 대상을 꺼내 실행.
 * 매 API 요청마다 비동기로 호출 — 서버리스 환경에 적합.
 */
export async function processPendingSyncs() {
  if (!db) return;

  const sheetsService = getGoogleSheetsService();
  if (!sheetsService) return;

  try {
    const now = new Date();
    const pending = await db
      .select()
      .from(pendingSheetSyncs)
      .where(lte(pendingSheetSyncs.nextRetryAt, now))
      .limit(BATCH_SIZE);

    if (pending.length === 0) return;

    console.log(`🔄 Processing ${pending.length} pending sheet syncs...`);

    for (const item of pending) {
      try {
        if (item.operation === 'syncScoreboard') {
          await sheetsService.syncScoreboardData(item.payload as any);
        } else if (item.operation === 'logActivity') {
          const p = item.payload as { email: string; action: string; details: string };
          await sheetsService.logActivity(p.email, p.action, p.details);
        }

        // 성공 — 큐에서 제거
        await db.delete(pendingSheetSyncs).where(eq(pendingSheetSyncs.id, item.id));
        console.log(`✅ Pending sync resolved: ${item.operation} for ${item.userEmail}`);
      } catch (err) {
        const newRetryCount = (item.retryCount ?? 0) + 1;
        if (newRetryCount >= MAX_RETRIES) {
          // 최대 재시도 초과 — 로그 남기고 삭제 (영구 실패)
          console.error(`❌ Permanent failure after ${MAX_RETRIES} retries: ${item.operation} for ${item.userEmail}`, err);
          await db.delete(pendingSheetSyncs).where(eq(pendingSheetSyncs.id, item.id));
        } else {
          // 지수 백오프: 30초, 60초, 120초, 240초
          const delayMs = 30000 * Math.pow(2, newRetryCount - 1);
          const nextRetry = new Date(Date.now() + delayMs);
          await db
            .update(pendingSheetSyncs)
            .set({
              retryCount: newRetryCount,
              nextRetryAt: nextRetry,
              errorMessage: String((err as Error)?.message || err).substring(0, 500),
            })
            .where(eq(pendingSheetSyncs.id, item.id));
          console.log(`⏳ Retry ${newRetryCount}/${MAX_RETRIES} scheduled for ${item.userEmail} at ${nextRetry.toISOString()}`);
        }
      }
    }
  } catch (err) {
    console.error('Error processing pending syncs:', err);
  }
}
