/**
 * Cache Manager with LRU eviction and TTL support.
 *
 * Ported from jhomen368/steam-reviews-mcp (MIT) — the "70-85% API call cut"
 * cache: aggressive in-memory caching with Least Recently Used eviction and
 * variable TTLs. Hit/miss statistics are exposed via the get_cache_stats tool.
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

interface InternalCacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessOrder: number;
}

export class CacheManager<T> {
  private cache = new Map<string, InternalCacheEntry<T>>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;
  private accessCounter = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  private isExpired(entry: InternalCacheEntry<T>): boolean {
    return Date.now() > entry.timestamp + entry.ttl;
  }

  private evictLRU(): void {
    if (this.cache.size < this.maxSize) return;
    let lruKey: string | null = null;
    let lruOrder = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessOrder < lruOrder) {
        lruOrder = entry.accessOrder;
        lruKey = key;
      }
    }
    if (lruKey !== null) this.cache.delete(lruKey);
  }

  set(key: string, value: T, ttl: number): void {
    if (!this.cache.has(key)) this.evictLRU();
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl,
      accessOrder: ++this.accessCounter,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    entry.accessOrder = ++this.accessCounter;
    this.hits++;
    return entry.data;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;
    return { size: this.cache.size, hits: this.hits, misses: this.misses, hitRate };
  }
}
