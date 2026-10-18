import { AsyncLocalStorage } from 'node:async_hooks';
import { API_RATE_LIMITS } from './constants.js';

/**
 * 큐 작업 안에서 다시 enqueue 하면(저장 → 캐시 조회) 바깥 작업이 슬롯을 쥔 채
 * 안쪽 작업을 기다리고, 안쪽은 바깥 배치가 끝나야 시작돼 60초 타임아웃까지 멈췄다
 * (2026-10-16 오프라인 재현). 지금은 '이미 큐 안에서 도는 중'이면 안쪽을 바로 실행한다.
 * 바깥 작업이 이미 슬롯과 rate 몫을 차지하고 있으므로 한도를 넘지 않는다.
 */
interface QueueContext {
  heldLocks: Set<string>;
}
const queueContext = new AsyncLocalStorage<QueueContext>();

interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  retryCount: number;
  lockKey?: string;
}

class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeRequests = 0;
  private requestTimestamps: number[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private locks = new Map<string, Promise<void>>();
  private lockOwners = new Map<string, string>();

  constructor() {
    this.startCleanupInterval();
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTimestamps();
    }, API_RATE_LIMITS.QUEUE_CLEANUP_INTERVAL_MS);
  }

  private cleanupOldTimestamps() {
    const now = Date.now();
    const cutoff = now - API_RATE_LIMITS.RATE_LIMIT_WINDOW_MS;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  private lockResolvers = new Map<string, () => void>();

  private async acquireLock(lockKey: string, requestId: string): Promise<void> {
    while (this.locks.has(lockKey)) {
      const owner = this.lockOwners.get(lockKey);
      console.log(`🔒 Request ${requestId} waiting for lock "${lockKey}" (currently held by ${owner})`);
      await this.locks.get(lockKey);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    this.locks.set(lockKey, lockPromise);
    this.lockResolvers.set(lockKey, resolveLock!);
    this.lockOwners.set(lockKey, requestId);
    
    console.log(`🔓 Request ${requestId} acquired lock "${lockKey}"`);

    return;
  }

  private releaseLock(lockKey: string, requestId: string): void {
    const owner = this.lockOwners.get(lockKey);
    if (owner === requestId) {
      const resolver = this.lockResolvers.get(lockKey);
      if (resolver) {
        resolver();
        this.lockResolvers.delete(lockKey);
      }
      this.locks.delete(lockKey);
      this.lockOwners.delete(lockKey);
      console.log(`🔓 Request ${requestId} released lock "${lockKey}"`);
    }
  }

  private canMakeRequest(): boolean {
    this.cleanupOldTimestamps();
    
    if (this.activeRequests >= API_RATE_LIMITS.MAX_CONCURRENT_REQUESTS) {
      return false;
    }

    if (this.requestTimestamps.length >= API_RATE_LIMITS.MAX_REQUESTS_PER_WINDOW) {
      return false;
    }

    return true;
  }

  private async executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
    const ctx: QueueContext = { heldLocks: new Set() };
    let timer: NodeJS.Timeout | undefined;
    try {
      if (request.lockKey) {
        await this.acquireLock(request.lockKey, request.id);
        ctx.heldLocks.add(request.lockKey);
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, API_RATE_LIMITS.REQUEST_TIMEOUT_MS);
      });

      const result = await Promise.race([
        queueContext.run(ctx, () => request.execute()),
        timeoutPromise
      ]);

      request.resolve(result);
    } catch (error) {
      if (request.retryCount < API_RATE_LIMITS.MAX_RETRY_ATTEMPTS) {
        const retryDelay = API_RATE_LIMITS.RETRY_DELAY_MS *
          Math.pow(API_RATE_LIMITS.RETRY_BACKOFF_MULTIPLIER, request.retryCount);

        console.log(`⚠️ Request ${request.id} failed, retrying in ${retryDelay}ms (attempt ${request.retryCount + 1}/${API_RATE_LIMITS.MAX_RETRY_ATTEMPTS})`);

        // 재시도 대기 중에는 슬롯과 잠금을 쥐고 있지 않는다.
        request.retryCount++;
        setTimeout(() => {
          this.queue.unshift(request);
          this.processQueue();
        }, retryDelay);
      } else {
        console.error(`❌ Request ${request.id} failed after ${API_RATE_LIMITS.MAX_RETRY_ATTEMPTS} attempts:`, error);
        request.reject(error as Error);
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.activeRequests--;

      if (request.lockKey) {
        this.releaseLock(request.lockKey, request.id);
      }
    }
  }

  private pumpTimer: NodeJS.Timeout | null = null;

  /**
   * 빈 슬롯만큼 꺼내 실행을 '시작'만 하고 돌아온다. 예전처럼 배치 전체가 끝날 때까지
   * 기다리지 않으므로, 실행 중인 작업이 끝나는 즉시 다음 작업이 슬롯을 받는다.
   */
  private processQueue() {
    while (this.queue.length > 0 && this.canMakeRequest()) {
      const request = this.queue.shift()!;
      this.activeRequests++;
      this.requestTimestamps.push(Date.now());
      void this.executeRequest(request).finally(() => this.processQueue());
    }
    if (this.queue.length > 0 && !this.pumpTimer) {
      // 슬롯이 아니라 rate 창 때문에 멈췄다면 아무 작업도 끝나지 않을 수 있다 — 주기적으로 다시 본다.
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null;
        this.processQueue();
      }, 500);
    }
  }

  async enqueue<T>(id: string, execute: () => Promise<T>, lockKey?: string): Promise<T> {
    const parent = queueContext.getStore();
    if (parent) {
      // 이미 큐 작업 안 — 다시 줄 서지 않고 바로 실행한다.
      if (!lockKey || parent.heldLocks.has(lockKey)) return execute();
      return this.withLock(lockKey, execute);
    }

    if (this.queue.length >= API_RATE_LIMITS.MAX_QUEUE_SIZE) {
      throw new Error('Queue is full. Too many concurrent requests.');
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id,
        execute,
        resolve,
        reject,
        timestamp: Date.now(),
        retryCount: 0,
        lockKey
      };

      this.queue.push(request);
      
      const lockInfo = lockKey ? ` [LOCK: ${lockKey}]` : '';
      console.log(`📝 Enqueued request ${id}${lockInfo} (queue size: ${this.queue.length}, active: ${this.activeRequests})`);
      
      this.processQueue();
    });
  }

  getStats() {
    return {
      queueSize: this.queue.length,
      activeRequests: this.activeRequests,
      requestsInWindow: this.requestTimestamps.length,
      canMakeRequest: this.canMakeRequest()
    };
  }

  async withLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    const operationId = `withLock-${lockKey}-${Date.now()}`;
    
    try {
      await this.acquireLock(lockKey, operationId);
      console.log(`🔐 Starting locked operation for ${lockKey}`);
      
      const parent = queueContext.getStore();
      const ctx: QueueContext = { heldLocks: new Set([...(parent?.heldLocks || []), lockKey]) };
      const result = await queueContext.run(ctx, operation);
      
      console.log(`✅ Completed locked operation for ${lockKey}`);
      return result;
    } finally {
      this.releaseLock(lockKey, operationId);
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const requestQueue = new RequestQueue();
