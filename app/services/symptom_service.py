import asyncio
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from app.cache.cache_key import build_cache_key
from app.cache.ttl_lru_cache import TtlLruCache
from app.domain.red_flags import detect_red_flags
from app.domain.schemas import Analysis, DiagnosisMeta, DiagnosisRecord, SymptomInput
from app.errors import AppError, UnrecognizedSymptomsError
from app.history.repository import HistoryRepository
from app.llm.prompt import PROMPT_VERSION
from app.llm.provider import DiagnosisProvider


class SymptomService:
    """Orchestrates one symptom check: red-flag screen -> cache -> LLM -> history.

    Input is assumed to be validated already (see app/api/routes.py).
    """

    def __init__(
        self,
        *,
        provider: DiagnosisProvider,
        cache: TtlLruCache[Analysis],
        history: HistoryRepository,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._provider = provider
        self._cache = cache
        self._history = history
        self._clock = clock
        # Identical requests that arrive while the first is still running share one LLM call.
        self._in_flight: dict[str, asyncio.Future[Analysis]] = {}

    async def check(self, client_id: str, symptom_input: SymptomInput) -> DiagnosisRecord:
        started = self._clock()
        key = build_cache_key(symptom_input, self._provider.model_id, PROMPT_VERSION)
        red_flags = detect_red_flags(symptom_input.symptoms)

        analysis = self._cache.get(key)
        cached = analysis is not None
        if analysis is None:
            try:
                analysis = await self._analyze_once(key, symptom_input)
            except AppError as exc:
                # Emergency warnings must reach the patient even when the model is down.
                if red_flags:
                    raise exc.with_details({"redFlags": red_flags}) from exc
                raise

        if not analysis.recognized_as_symptoms:
            raise UnrecognizedSymptomsError()

        record = DiagnosisRecord(
            id=str(uuid.uuid4()),
            created_at=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            input=symptom_input,
            analysis=analysis,
            red_flags=red_flags,
            meta=DiagnosisMeta(
                cached=cached,
                latency_ms=round((self._clock() - started) * 1000),
                model=self._provider.model_id,
            ),
        )
        self._history.save(client_id, record)
        return record

    async def _analyze_once(self, key: str, symptom_input: SymptomInput) -> Analysis:
        pending = self._in_flight.get(key)
        if pending is not None:
            return await asyncio.shield(pending)

        future: asyncio.Future[Analysis] = asyncio.get_running_loop().create_future()
        self._in_flight[key] = future
        try:
            analysis = await self._provider.analyze(symptom_input)
        except asyncio.CancelledError:
            future.cancel()
            raise
        except Exception as exc:
            future.set_exception(exc)
            future.exception()  # mark retrieved so an unawaited failure isn't logged as "never retrieved"
            raise
        else:
            # Unrecognised input is cached too, so repeated junk doesn't cost an LLM call each time.
            self._cache.set(key, analysis)
            future.set_result(analysis)
            return analysis
        finally:
            del self._in_flight[key]
