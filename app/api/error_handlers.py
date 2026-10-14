import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError, RateLimitedError

logger = logging.getLogger(__name__)


def _error(
    status: int, code: str, message: str, details: Any = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    """Every error response has the same shape: {"error": {"code", "message", "details"?}}."""
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse({"error": body}, status_code=status, headers=headers)


def _validation_message(exc: RequestValidationError) -> tuple[str, str]:
    first = exc.errors()[0] if exc.errors() else {}
    kind = first.get("type", "")
    loc = tuple(first.get("loc", ()))
    if kind == "json_invalid":
        return "BAD_REQUEST", "Request body must be valid JSON."
    if kind == "missing" and loc in (("body",), ("body", "symptoms")):
        return "VALIDATION_ERROR", "Please describe your symptoms."
    message = str(first.get("msg", "Invalid request."))
    return "VALIDATION_ERROR", message.removeprefix("Value error, ")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        if exc.status >= 500:
            logger.warning("%s %s -> %s %s", request.method, request.url.path, exc.status, exc.code)
        headers = {"Retry-After": str(exc.retry_after_seconds)} if isinstance(exc, RateLimitedError) else None
        return _error(exc.status, exc.code, exc.message, exc.details, headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        code, message = _validation_message(exc)
        return _error(400, code, message)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.")
