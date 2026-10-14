from app.cache.cache_key import build_cache_key, normalize_symptoms
from app.cache.ttl_lru_cache import CacheStats, TtlLruCache
from app.domain.schemas import SymptomInput


def test_returns_values_and_counts_hits_and_misses() -> None:
    cache: TtlLruCache[int] = TtlLruCache(max_entries=10, ttl_seconds=1)
    assert cache.get("a") is None
    cache.set("a", 1)
    assert cache.get("a") == 1
    assert cache.stats() == CacheStats(size=1, max_entries=10, hits=1, misses=1)


def test_expires_entries_after_ttl() -> None:
    now = 0.0
    cache: TtlLruCache[int] = TtlLruCache(max_entries=10, ttl_seconds=1, clock=lambda: now)
    cache.set("a", 1)
    now = 0.999
    assert cache.get("a") == 1
    now = 1.0
    assert cache.get("a") is None
    assert cache.stats().size == 0


def test_evicts_least_recently_used_when_full() -> None:
    cache: TtlLruCache[int] = TtlLruCache(max_entries=2, ttl_seconds=60)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")  # "b" is now least recently used
    cache.set("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3


def test_normalises_case_punctuation_and_whitespace() -> None:
    assert normalize_symptoms("  Headache,   FEVER!! ") == "headache fever"


def test_cosmetically_different_inputs_share_a_key() -> None:
    a = build_cache_key(SymptomInput(symptoms="Sore throat, fever."), "m", "v1")
    b = build_cache_key(SymptomInput(symptoms="sore throat fever"), "m", "v1")
    assert a == b


def test_context_model_and_prompt_version_change_the_key() -> None:
    base = build_cache_key(SymptomInput(symptoms="sore throat fever"), "m", "v1")
    assert base != build_cache_key(SymptomInput(symptoms="sore throat fever", age=5), "m", "v1")
    assert base != build_cache_key(SymptomInput(symptoms="sore throat fever"), "other", "v1")
    assert base != build_cache_key(SymptomInput(symptoms="sore throat fever"), "m", "v2")
