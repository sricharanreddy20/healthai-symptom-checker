import asyncio

import pytest

from app.cache.ttl_lru_cache import TtlLruCache
from app.domain.schemas import Analysis, SymptomInput
from app.errors import AppError, LlmUnavailableError, UnrecognizedSymptomsError
from app.history.repository import HistoryRepository
from app.services.symptom_service import SymptomService
from tests.conftest import SAMPLE_ANALYSIS, FakeProvider

pytestmark = pytest.mark.anyio
CLIENT = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider(delay_seconds=0.05)


@pytest.fixture
def history() -> HistoryRepository:
    return HistoryRepository(":memory:")


@pytest.fixture
def service(provider: FakeProvider, history: HistoryRepository) -> SymptomService:
    cache: TtlLruCache[Analysis] = TtlLruCache(max_entries=10, ttl_seconds=60)
    return SymptomService(provider=provider, cache=cache, history=history)


async def test_returns_analysis_and_saves_history(service: SymptomService, history: HistoryRepository) -> None:
    record = await service.check(CLIENT, SymptomInput(symptoms="sore throat and fever"))
    assert record.analysis == SAMPLE_ANALYSIS
    assert record.meta.cached is False
    assert [r.id for r in history.list(CLIENT, 10)] == [record.id]


async def test_repeat_query_is_served_from_cache(
    service: SymptomService, provider: FakeProvider, history: HistoryRepository
) -> None:
    first = await service.check(CLIENT, SymptomInput(symptoms="Sore throat and fever"))
    second = await service.check(CLIENT, SymptomInput(symptoms="sore throat, and fever."))
    assert len(provider.calls) == 1
    assert second.meta.cached is True
    assert second.meta.latency_ms < first.meta.latency_ms
    assert len(history.list(CLIENT, 10)) == 2


async def test_concurrent_identical_requests_share_one_call(service: SymptomService, provider: FakeProvider) -> None:
    symptoms = SymptomInput(symptoms="sore throat and fever")
    await asyncio.gather(service.check(CLIENT, symptoms), service.check(CLIENT, symptoms))
    assert len(provider.calls) == 1


async def test_rejects_input_that_is_not_symptoms(
    service: SymptomService, provider: FakeProvider, history: HistoryRepository
) -> None:
    provider.result = SAMPLE_ANALYSIS.model_copy(update={"recognized_as_symptoms": False, "conditions": []})
    with pytest.raises(UnrecognizedSymptomsError):
        await service.check(CLIENT, SymptomInput(symptoms="what is the capital of France"))
    assert history.list(CLIENT, 10) == []


async def test_failures_are_not_cached(service: SymptomService, provider: FakeProvider) -> None:
    provider.result = LlmUnavailableError()
    with pytest.raises(LlmUnavailableError):
        await service.check(CLIENT, SymptomInput(symptoms="sore throat and fever"))
    provider.result = SAMPLE_ANALYSIS
    record = await service.check(CLIENT, SymptomInput(symptoms="sore throat and fever"))
    assert record.meta.cached is False


async def test_red_flags_survive_a_model_outage(service: SymptomService, provider: FakeProvider) -> None:
    provider.result = LlmUnavailableError()
    with pytest.raises(AppError) as info:
        await service.check(CLIENT, SymptomInput(symptoms="sudden chest pain at rest"))
    assert info.value.status == 503
    assert info.value.details == {"redFlags": ["Chest pain or pressure"]}
