import math
import time
from collections import defaultdict, deque
from collections.abc import Callable

from fastapi import Request

from app.errors import RateLimitedError


class SlidingWindowRateLimiter:
    """Allows `limit` requests per `window_seconds` per client IP (in memory, single process).

    Used as a FastAPI dependency on the endpoint that calls the LLM, because those calls cost money.
    """

    def __init__(self, *, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        now = self._clock()
        hits = self._hits[key]
        while hits and hits[0] <= now - self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            raise RateLimitedError(retry_after_seconds=math.ceil(hits[0] + self._window - now))
        hits.append(now)
