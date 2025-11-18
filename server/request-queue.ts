import { API_RATE_LIMITS } from '@shared/constants';

interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  retryCount: number;
}

class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeRequests = 0;
  private requestTimestamps: number[] = [];
  private isProcessing = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

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
    const startTime = Date.now();
    
    try {
      this.activeRequests++;
      this.requestTimestamps.push(startTime);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Request timeout'));
        }, API_RATE_LIMITS.REQUEST_TIMEOUT_MS);
      });

      const result = await Promise.race([
        request.execute(),
        timeoutPromise
      ]);

      request.resolve(result);
    } catch (error) {
      if (request.retryCount < API_RATE_LIMITS.MAX_RETRY_ATTEMPTS) {
        const retryDelay = API_RATE_LIMITS.RETRY_DELAY_MS * 
          Math.pow(API_RATE_LIMITS.RETRY_BACKOFF_MULTIPLIER, request.retryCount);
        
        console.log(`⚠️ Request ${request.id} failed, retrying in ${retryDelay}ms (attempt ${request.retryCount + 1}/${API_RATE_LIMITS.MAX_RETRY_ATTEMPTS})`);
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        request.retryCount++;
        this.queue.unshift(request);
      } else {
        console.error(`❌ Request ${request.id} failed after ${API_RATE_LIMITS.MAX_RETRY_ATTEMPTS} attempts:`, error);
        request.reject(error as Error);
      }
    } finally {
      this.activeRequests--;
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      if (!this.canMakeRequest()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const request = this.queue.shift();
      if (!request) continue;

      await this.executeRequest(request);
    }

    this.isProcessing = false;
  }

  async enqueue<T>(id: string, execute: () => Promise<T>): Promise<T> {
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
        retryCount: 0
      };

      this.queue.push(request);
      
      console.log(`📝 Enqueued request ${id} (queue size: ${this.queue.length}, active: ${this.activeRequests})`);
      
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

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const requestQueue = new RequestQueue();
