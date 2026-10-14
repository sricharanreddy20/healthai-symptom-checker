type Entry<V> = { value: V; expiresAt: number };

export type CacheStats = { size: number; maxEntries: number; hits: number; misses: number };

/**
 * In-memory LRU cache with per-entry TTL. A Map keeps insertion order, so
 * re-inserting on read moves an entry to the "most recent" end and the first
 * key is always the least recently used one. All operations are O(1).
 */
export class TtlLruCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private hits = 0;
  private misses = 0;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { maxEntries: number; ttlMs: number; now?: () => number }) {
    this.maxEntries = opts.maxEntries;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  stats(): CacheStats {
    return { size: this.entries.size, maxEntries: this.maxEntries, hits: this.hits, misses: this.misses };
  }
}
