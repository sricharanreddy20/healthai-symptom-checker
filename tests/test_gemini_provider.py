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


def provider_returning(result: Any, sent: dict[str, Any] | None = None, timeout: float = 5) -> GeminiProvider:
    """GeminiProvider with a stub client; only client.aio.models.generate_content is used."""

    async def generate_content(**kwargs: Any) -> Any:
        if sent is not None:
            sent.update(kwargs)
        if isinstance(result, BaseException):
            raise result
        if callable(result):
            return await result()
        return result

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return GeminiProvider(api_key="test", model="gemini-test", timeout_seconds=timeout, client=client)  # type: ignore[arg-type]


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
    assert isinstance(map_sdk_error(api_error(errors.ClientError, 404, "model not found")), LlmFailedError)


def test_unknown_errors_pass_through() -> None:
    err = TypeError("boom")
    assert map_sdk_error(err) is err
