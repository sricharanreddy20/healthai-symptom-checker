import asyncio

import pytest

from app.config import Settings
from app.domain.schemas import Analysis, Condition, SymptomInput

SAMPLE_ANALYSIS = Analysis(
    recognized_as_symptoms=True,
    summary="Likely a common cold.",
    urgency="self_care",
    conditions=[
        Condition(
            name="Common cold",
            likelihood="high",
            explanation="Typical symptoms.",
            matching_symptoms=["sore throat"],
            next_steps="Rest.",
        )
    ],
    self_care_tips=["Drink fluids"],
    seek_care_if=["Fever above 39C"],
    follow_up_questions=["When did it start?"],
)


class FakeProvider:
    """Records calls and lets a test control latency and the returned analysis (or error)."""

    def __init__(self, result: Analysis | Exception = SAMPLE_ANALYSIS, delay_seconds: float = 0) -> None:
        self.result = result
        self.delay_seconds = delay_seconds
        self.calls: list[SymptomInput] = []

    @property
    def model_id(self) -> str:
        return "fake-model"

    async def analyze(self, symptom_input: SymptomInput) -> Analysis:
        self.calls.append(symptom_input)
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def make_settings(**overrides: object) -> Settings:
    # _env_file=None so a developer's real .env never leaks into tests.
    values: dict[str, object] = {"db_path": ":memory:", "llm_provider": "mock", "mock_latency_seconds": 0}
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
