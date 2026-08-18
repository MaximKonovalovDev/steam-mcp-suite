/**
 * Exponential-backoff retry — ported from jhomen368/steam-reviews-mcp (MIT).
 * Retries transient failures (network errors, timeouts, 429, 5xx) only.
 */
interface HttpErrorLike {
  code?: string;
  name?: string;
  message?: string;
  response?: { status: number; headers?: Record<string, string> };
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxRetries: 2,
  initialDelay: 150,
  maxDelay: 3000,
  backoffMultiplier: 2,
};

function isRetryableError(error: unknown): boolean {
  const e = error as HttpErrorLike;
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"].includes(e.code ?? "")) {
    return true;
  }
  const status = e.response?.status;
  if (status && status >= 500) return true;
  if (status === 429) return true;
  if (e.name === "TimeoutError" || (typeof e.message === "string" && e.message.includes("timeout"))) {
    return true;
  }
  return false;
}

function getRetryAfterMs(error: unknown): number | null {
  const ra = (error as HttpErrorLike).response?.headers?.["retry-after"];
  if (!ra) return null;
  const seconds = parseInt(ra, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  const date = new Date(ra);
  if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableError(error) || attempt === config.maxRetries) throw lastError;
      let delay: number;
      if ((error as HttpErrorLike).response?.status === 429) {
        delay = getRetryAfterMs(error) ?? 5000;
      } else {
        delay = Math.min(config.initialDelay * Math.pow(config.backoffMultiplier, attempt), config.maxDelay);
      }
      config.onRetry?.(lastError, attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error("Retry exhausted without error");
}
