import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

V = TypeVar("V")


@dataclass(frozen=True)
class CacheStats:
    size: int
    max_entries: int
    hits: int
    misses: int


class TtlLruCache(Generic[V]):
    """In-memory LRU cache with a per-entry time-to-live.

    An OrderedDict keeps entries in recency order: reads move an entry to the
    end, so the first key is always the least recently used. All operations are O(1).
    """

    def __init__(self, *, max_entries: int, ttl_seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._entries: OrderedDict[str, tuple[V, float]] = OrderedDict()
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> V | None:
        entry = self._entries.get(key)
        if entry is None or entry[1] <= self._clock():
            if entry is not None:
                del self._entries[key]
            self._misses += 1
            return None
        self._entries.move_to_end(key)
        self._hits += 1
        return entry[0]

    def set(self, key: str, value: V) -> None:
        self._entries[key] = (value, self._clock() + self._ttl_seconds)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def stats(self) -> CacheStats:
        return CacheStats(len(self._entries), self._max_entries, self._hits, self._misses)
