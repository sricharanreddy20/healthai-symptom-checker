import asyncio
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from google.genai import errors, types

from app.domain.schemas import SymptomInput
from app.errors import LlmFailedError, LlmUnavailableError
from app.llm.gemini_provider import GeminiProvider, map_sdk_error
from tests.conftest import SAMPLE_ANALYSIS

pytestmark = pytest.mark.anyio


def response(text: str | None, finish: types.FinishReason = types.FinishReason.STOP) -> types.GenerateContentResponse:
    parts = [types.Part(text=text)] if text is not None else []
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts), finish_reason=finish)]
    )


def provider_returning(
    result: Any,
    sent: dict[str, Any] | None = None,
    timeout: float = 5,
    fallbacks: tuple[str, ...] = (),
    calls: list[str] | None = None,
) -> GeminiProvider:
    """GeminiProvider with a stub client; only client.aio.models.generate_content is used.

    `result` may be a dict of model name -> result to give each model a different outcome.
    """

    async def generate_content(**kwargs: Any) -> Any:
        if sent is not None:
            sent.update(kwargs)
        if calls is not None:
            calls.append(kwargs["model"])
        outcome = result[kwargs["model"]] if isinstance(result, dict) else result
        return await _resolve(outcome)

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return GeminiProvider(  # type: ignore[arg-type]
        api_key="test", model="gemini-test", timeout_seconds=timeout, fallback_models=fallbacks, client=client
    )


async def _resolve(result: Any) -> Any:
    if isinstance(result, BaseException):
        raise result
    if callable(result):
        return await result()
    return result


async def test_sends_schema_constrained_request_and_parses_json() -> None:
    sent: dict[str, Any] = {}
    provider = provider_returning(response(SAMPLE_ANALYSIS.model_dump_json(by_alias=True)), sent)
    result = await provider.analyze(SymptomInput(symptoms="sore throat and fever", age=30))

    assert result == SAMPLE_ANALYSIS
    assert sent["model"] == "gemini-test"
    assert sent["contents"] == "<symptoms>\nsore throat and fever\n</symptoms>\nAge: 30"
    config: types.GenerateContentConfig = sent["config"]
    assert config.response_mime_type == "application/json"
    assert "recognizedAsSymptoms" in config.response_json_schema["properties"]  # type: ignore[index]


@pytest.mark.parametrize(
    "bad_response",
    [
        response("not json"),
        response('{"summary": "missing fields"}'),
        response(None),
        response("{}", types.FinishReason.MAX_TOKENS),
        response(None, types.FinishReason.SAFETY),
        types.GenerateContentResponse(
            prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=types.BlockedReason.SAFETY)
        ),
    ],
)
async def test_unusable_responses_become_llm_failed(bad_response: types.GenerateContentResponse) -> None:
    with pytest.raises(LlmFailedError):
        await provider_returning(bad_response).analyze(SymptomInput(symptoms="sore throat and fever"))


async def test_slow_responses_time_out_with_504() -> None:
    async def slow() -> None:
        await asyncio.sleep(1)

    with pytest.raises(LlmUnavailableError) as info:
        await provider_returning(slow, timeout=0.05).analyze(SymptomInput(symptoms="sore throat and fever"))
    assert info.value.status == 504


OK = response(SAMPLE_ANALYSIS.model_dump_json(by_alias=True))


async def test_falls_back_when_primary_model_is_overloaded() -> None:
    calls: list[str] = []
    overloaded = api_error(errors.ServerError, 503, "high demand")
    provider = provider_returning({"gemini-test": overloaded, "backup": OK}, fallbacks=("backup",), calls=calls)
    assert await provider.analyze(SymptomInput(symptoms="sore throat and fever")) == SAMPLE_ANALYSIS
    assert calls == ["gemini-test", "backup"]
    assert provider.model_id == "gemini-test+backup"


async def test_falls_back_when_primary_model_is_too_slow() -> None:
    async def slow() -> None:
        await asyncio.sleep(1)

    provider = provider_returning({"gemini-test": slow, "backup": OK}, timeout=0.2, fallbacks=("backup",))
    assert await provider.analyze(SymptomInput(symptoms="sore throat and fever")) == SAMPLE_ANALYSIS


async def test_does_not_fall_back_on_configuration_errors() -> None:
    calls: list[str] = []
    missing = api_error(errors.ClientError, 404, "model not found")
    provider = provider_returning({"gemini-test": missing, "backup": OK}, fallbacks=("backup",), calls=calls)
    with pytest.raises(LlmFailedError, match="not configured correctly"):
        await provider.analyze(SymptomInput(symptoms="sore throat and fever"))
    assert calls == ["gemini-test"]


async def test_reports_unavailable_when_every_model_is_overloaded() -> None:
    overloaded = api_error(errors.ServerError, 503, "high demand")
    provider = provider_returning(overloaded, fallbacks=("backup",))
    with pytest.raises(LlmUnavailableError):
        await provider.analyze(SymptomInput(symptoms="sore throat and fever"))


def api_error(cls: type[errors.APIError], code: int, message: str, reason: str | None = None) -> errors.APIError:
    error: dict[str, Any] = {"code": code, "message": message, "status": "X"}
    if reason:
        error["details"] = [{"reason": reason}]
    return cls(code, {"error": error})


def test_retryable_failures_map_to_503() -> None:
    assert isinstance(map_sdk_error(api_error(errors.ClientError, 429, "quota exceeded")), LlmUnavailableError)
    assert isinstance(map_sdk_error(api_error(errors.ServerError, 503, "overloaded")), LlmUnavailableError)
    assert isinstance(map_sdk_error(httpx.ConnectError("down")), LlmUnavailableError)


def test_invalid_key_maps_to_502_without_leaking_details() -> None:
    mapped = map_sdk_error(api_error(errors.ClientError, 400, "API key not valid.", reason="API_KEY_INVALID"))
    assert isinstance(mapped, LlmFailedError)
    assert "API key" not in str(mapped)
    assert "not configured correctly" in str(mapped)


def test_other_client_errors_map_to_502() -> None:
    assert isinstance(map_sdk_error(api_error(errors.ClientError, 400, "bad request")), LlmFailedError)


def test_unknown_errors_pass_through() -> None:
    err = TypeError("boom")
    assert map_sdk_error(err) is err
