import asyncio
import logging
from collections.abc import Sequence
from typing import Any

import httpx
import pydantic
from google import genai
from google.genai import errors, types

from app.domain.schemas import Analysis, SymptomInput
from app.errors import AppError, LlmFailedError, LlmUnavailableError
from app.llm.prompt import SYSTEM_PROMPT, render_user_message

logger = logging.getLogger(__name__)

# Gemini enforces this schema on its output (structured output / JSON mode).
ANALYSIS_JSON_SCHEMA: dict[str, Any] = Analysis.model_json_schema(by_alias=True)

_MISCONFIGURED = "The analysis service is not configured correctly. Please contact support."

_BLOCKED_FINISH_REASONS = {
    types.FinishReason.SAFETY,
    types.FinishReason.PROHIBITED_CONTENT,
    types.FinishReason.BLOCKLIST,
    types.FinishReason.SPII,
    types.FinishReason.RECITATION,
}


class GeminiProvider:
    """Calls Google Gemini with a JSON schema so the response always matches `Analysis`.

    Popular Gemini models are sometimes overloaded (503 "high demand"). When the
    primary model is unavailable or too slow, the same request is retried on the
    fallback models in order, so the patient still gets an answer.
    """

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        timeout_seconds: float,
        fallback_models: Sequence[str] = (),
        client: genai.Client | None = None,
    ) -> None:
        self._models = [model, *(m for m in fallback_models if m != model)]
        # The time budget is split across the models so a fallback still has time to answer.
        self._attempt_timeout = timeout_seconds / len(self._models)
        # One SDK-level retry per model (with backoff) for brief 429/5xx blips.
        self._client = client or genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=2)),
        )
        self._config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_json_schema=ANALYSIS_JSON_SCHEMA,
        )

    @property
    def model_id(self) -> str:
        return "+".join(self._models)

    async def analyze(self, symptom_input: SymptomInput) -> Analysis:
        contents = render_user_message(symptom_input)
        for index, model in enumerate(self._models):
            try:
                async with asyncio.timeout(self._attempt_timeout):
                    response = await self._client.aio.models.generate_content(
                        model=model, contents=contents, config=self._config
                    )
            except Exception as exc:
                error = map_sdk_error(exc)
                is_last = index == len(self._models) - 1
                if isinstance(error, LlmUnavailableError) and not is_last:
                    logger.warning("Gemini model %s unavailable (%s); falling back", model, error.message)
                    continue
                raise error from exc
            if index > 0:
                logger.info("Answered by fallback model %s", model)
            return parse_response(response)
        raise LlmUnavailableError()  # unreachable: the loop always returns or raises


def parse_response(response: types.GenerateContentResponse) -> Analysis:
    """Turns a Gemini response into an Analysis, or raises a patient-safe error."""
    if response.prompt_feedback and response.prompt_feedback.block_reason:
        logger.warning("Gemini blocked the prompt: %s", response.prompt_feedback.block_reason)
        raise LlmFailedError("We couldn't analyse that description. Please rephrase it and try again.")

    candidate = response.candidates[0] if response.candidates else None
    finish_reason = candidate.finish_reason if candidate else None
    if finish_reason == types.FinishReason.MAX_TOKENS:
        raise LlmFailedError("The analysis was cut short. Please try a shorter description.")
    if finish_reason in _BLOCKED_FINISH_REASONS:
        logger.warning("Gemini stopped with finish reason %s", finish_reason)
        raise LlmFailedError("We couldn't analyse that description. Please rephrase it and try again.")

    text = response.text
    if not text:
        raise LlmFailedError()
    try:
        return Analysis.model_validate_json(text)
    except pydantic.ValidationError as exc:
        logger.error("Gemini output did not match the schema: %s", exc)
        raise LlmFailedError() from exc


def map_sdk_error(exc: Exception) -> Exception:
    """Translates SDK/network errors into patient-safe AppErrors, most specific first."""
    if isinstance(exc, AppError):
        return exc
    if isinstance(exc, TimeoutError | httpx.TimeoutException):
        return LlmUnavailableError("The analysis took too long. Please try again.", status=504)
    if isinstance(exc, httpx.TransportError):
        return LlmUnavailableError()
    if isinstance(exc, errors.ClientError):
        if exc.code == 429:
            return LlmUnavailableError()
        if exc.code in (400, 401, 403) and _looks_like_auth_error(exc):
            logger.error("Gemini rejected the credentials - check GEMINI_API_KEY")
            return LlmFailedError(_MISCONFIGURED)
        if exc.code == 404:
            logger.error("Gemini model not found - check GEMINI_MODEL: %s", exc.message)
            return LlmFailedError(_MISCONFIGURED)
        logger.error("Gemini client error %s: %s", exc.code, exc.message)
        return LlmFailedError()
    if isinstance(exc, errors.ServerError):
        logger.error("Gemini server error %s: %s", exc.code, exc.message)
        return LlmUnavailableError()
    if isinstance(exc, errors.APIError):
        logger.error("Gemini API error %s: %s", exc.code, exc.message)
        return LlmFailedError()
    return exc


def _looks_like_auth_error(exc: errors.ClientError) -> bool:
    # Gemini reports an invalid key as 400 INVALID_ARGUMENT with reason API_KEY_INVALID.
    return exc.code in (401, 403) or "API_KEY" in str(exc.details) or "API key" in (exc.message or "")
