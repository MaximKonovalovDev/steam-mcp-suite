/**
 * Token-bucket rate limiter — ported from jhomen368/steam-reviews-mcp (MIT).
 * Continuous refill (not bursts) to keep Steam's unofficial storefront happy.
 */
export class RateLimiter {
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private tokens: number;
  private lastRefillTime: number;
  private waitQueue: Array<{ resolve: () => void; timestamp: number }> = [];

  constructor(maxRequests: number, windowMs: number) {
    if (maxRequests <= 0) throw new Error("maxRequests must be greater than 0");
    if (windowMs <= 0) throw new Error("windowMs must be greater than 0");
    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / windowMs;
    this.tokens = maxRequests;
    this.lastRefillTime = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    if (elapsed > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
      this.lastRefillTime = now;
    }
  }

  private getTimeUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }

  private processQueue(): void {
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const next = this.waitQueue.shift();
      if (next) {
        this.tokens -= 1;
        next.resolve();
      }
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push({ resolve, timestamp: Date.now() });
      const waitTime = this.getTimeUntilNextToken();
      if (waitTime > 0) {
        setTimeout(() => {
          this.refill();
          this.processQueue();
        }, waitTime);
      }
    });
  }

  getStatus(): { remaining: number; total: number; resetTime: number } {
    this.refill();
    return {
      remaining: Math.floor(this.tokens),
      total: this.maxTokens,
      resetTime: Date.now() + Math.ceil((this.maxTokens - this.tokens) / this.refillRate),
    };
  }
}
