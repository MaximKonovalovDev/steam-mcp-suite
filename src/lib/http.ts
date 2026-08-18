/**
 * Shared HTTP client: axios with browser-ish User-Agent, per-host rate
 * limiting, bounded retry and optional TTL caching. The cache is the
 * "70-85% API call cut" from jhomen368/steam-reviews-mcp (MIT).
 */
import axios, { type AxiosRequestConfig } from "axios";
import { CacheManager } from "./cache.js";
import { RateLimiter } from "./rateLimit.js";
import { retryWithBackoff } from "./retry.js";
import { AppError } from "../errors.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  limiter: RateLimiter;
  cache: CacheManager<unknown>;
  /** Per-host custom User-Agent (itch.io prefers a real browser UA). */
  userAgent?: string;
  /** Optional query params always appended (e.g. the API key when configured). */
  defaultQuery?: Record<string, string | number | boolean | undefined>;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface GetOptions {
  query?: Query;
  cacheKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export class HttpClient {
  private readonly opts: HttpOptions;

  constructor(opts: HttpOptions) {
    this.opts = opts;
  }

  async getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
    if (opts.cacheKey) {
      const cached = this.opts.cache.get(opts.cacheKey) as T | undefined;
      if (cached !== undefined) return cached;
    }

    await this.opts.limiter.acquire();

    const request: AxiosRequestConfig = {
      method: "GET",
      url,
      timeout: opts.timeoutMs ?? this.opts.timeoutMs,
      headers: { "User-Agent": this.opts.userAgent ?? BROWSER_UA },
      params: { ...this.opts.defaultQuery, ...opts.query },
      validateStatus: () => true,
    };

    const data = await retryWithBackoff<T>(
      async () => {
        const res = await axios.request<T>(request);
        if (res.status >= 200 && res.status < 300) return res.data;
        throw httpError(res.status, url);
      },
      { maxRetries: opts.retries ?? this.opts.retries },
    );

    if (opts.cacheKey && opts.cacheTtlMs !== undefined) {
      this.opts.cache.set(opts.cacheKey, data, opts.cacheTtlMs);
    }
    return data;
  }

  /** Fetch text (HTML scraping endpoints that are not JSON). */
  async getText(url: string, opts: GetOptions = {}): Promise<string> {
    if (opts.cacheKey) {
      const cached = this.opts.cache.get(opts.cacheKey) as string | undefined;
      if (cached !== undefined) return cached;
    }
    await this.opts.limiter.acquire();
    const data = await retryWithBackoff<string>(
      async () => {
        const res = await axios.request({
          method: "GET",
          url,
          timeout: opts.timeoutMs ?? this.opts.timeoutMs,
          headers: { "User-Agent": this.opts.userAgent ?? BROWSER_UA },
          params: opts.query,
          responseType: "text",
          validateStatus: () => true,
        });
        if (res.status >= 200 && res.status < 300) return res.data as string;
        throw httpError(res.status, url);
      },
      { maxRetries: opts.retries ?? this.opts.retries },
    );
    if (opts.cacheKey && opts.cacheTtlMs !== undefined) {
      this.opts.cache.set(opts.cacheKey, data, opts.cacheTtlMs);
    }
    return data;
  }
}

function httpError(status: number, url: string): AppError {
  const host = new URL(url).host;
  const api = host.includes("itch.io") ? "itch.io" : "Steam";
  if (status === 401 || status === 403) {
    return new AppError("auth", `${api} answered 403/401 — the profile is private or the request was blocked`);
  }
  if (status === 404) return new AppError("not_found", `${api} answered 404 — resource not found`);
  if (status === 429) return new AppError("rate_limit", `${api} rate-limited this request — try again shortly`);
  if (status >= 500) return new AppError("upstream", `${api} is temporarily unavailable (HTTP ${status})`);
  return new AppError("upstream", `${api} answered HTTP ${status}`);
}

/** Small concurrency pool for fan-out (e.g. batch appdetails). */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
