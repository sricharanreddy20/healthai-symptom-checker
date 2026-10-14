import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCacheKey, normalizeSymptoms } from "../src/cache/cacheKey.ts";
import { TtlLruCache } from "../src/cache/ttlLruCache.ts";

describe("TtlLruCache", () => {
  it("returns stored values and counts hits and misses", () => {
    const cache = new TtlLruCache<number>({ maxEntries: 10, ttlMs: 1000 });
    assert.equal(cache.get("a"), undefined);
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
    assert.deepEqual(cache.stats(), { size: 1, maxEntries: 10, hits: 1, misses: 1 });
  });

  it("expires entries after the TTL", () => {
    let now = 0;
    const cache = new TtlLruCache<number>({ maxEntries: 10, ttlMs: 1000, now: () => now });
    cache.set("a", 1);
    now = 999;
    assert.equal(cache.get("a"), 1);
    now = 1000;
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.stats().size, 0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new TtlLruCache<number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "b" is now least recently used
    cache.set("c", 3);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("c"), 3);
  });
});

describe("cache keys", () => {
  it("normalises case, punctuation and whitespace", () => {
    assert.equal(normalizeSymptoms("  Headache,   FEVER!! "), "headache fever");
  });

  it("matches cosmetically different inputs", () => {
    assert.equal(
      buildCacheKey({ symptoms: "Sore throat, fever." }, "m", "v1"),
      buildCacheKey({ symptoms: "sore throat fever" }, "m", "v1"),
    );
  });

  it("separates different context, models and prompt versions", () => {
    const base = buildCacheKey({ symptoms: "sore throat fever" }, "m", "v1");
    assert.notEqual(base, buildCacheKey({ symptoms: "sore throat fever", age: 5 }, "m", "v1"));
    assert.notEqual(base, buildCacheKey({ symptoms: "sore throat fever" }, "other", "v1"));
    assert.notEqual(base, buildCacheKey({ symptoms: "sore throat fever" }, "m", "v2"));
  });
});
