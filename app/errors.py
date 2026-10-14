"""Application errors.

Each error carries an HTTP status, a stable machine-readable code, and a message
that is safe to show to patients. Anything that is not an AppError is treated as
an unexpected 500 and its details are logged, never returned.
"""

from typing import Any


class AppError(Exception):
    status: int = 500
    code: str = "INTERNAL_ERROR"
    message: str = "Something went wrong on our side. Please try again."

    def __init__(self, message: str | None = None, *, details: Any = None, status: int | None = None) -> None:
        self.message = message or self.message
        self.details = details
        if status is not None:
            self.status = status
        super().__init__(self.message)

    def with_details(self, details: Any) -> "AppError":
        """Copy of this error with extra details attached (keeps the same status and code)."""
        clone = type(self)(self.message, details=details, status=self.status)
        return clone


class ValidationError(AppError):
    status = 400
    code = "VALIDATION_ERROR"
    message = "Invalid input."


class NotFoundError(AppError):
    status = 404
    code = "NOT_FOUND"
    message = "Not found."


class RateLimitedError(AppError):
    status = 429
    code = "RATE_LIMITED"
    message = "Too many requests. Please wait a minute and try again."

    def __init__(self, retry_after_seconds: int = 60) -> None:
        super().__init__()
        self.retry_after_seconds = retry_after_seconds


class UnrecognizedSymptomsError(AppError):
    """The input passed validation but the model judged it is not a description of symptoms."""

    status = 422
    code = "UNRECOGNIZED_SYMPTOMS"
    message = (
        "We couldn't identify any symptoms in that description. "
        'Please describe how you feel, e.g. "sore throat and fever for two days".'
    )


class LlmUnavailableError(AppError):
    """The model failed in a way the patient can retry (rate limit, overload, network, timeout)."""

    status = 503
    code = "LLM_UNAVAILABLE"
    message = "The analysis service is busy right now. Please try again in a moment."


class LlmFailedError(AppError):
    """The model failed in a way retrying won't fix (bad config, blocked or malformed output)."""

    status = 502
    code = "LLM_FAILED"
    message = "We couldn't analyse your symptoms. Please try rephrasing your description."
