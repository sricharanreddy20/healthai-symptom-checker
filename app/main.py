import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.error_handlers import register_error_handlers
from app.api.rate_limit import SlidingWindowRateLimiter
from app.api.routes import router
from app.cache.ttl_lru_cache import TtlLruCache
from app.config import Settings, get_settings
from app.domain.schemas import Analysis
from app.history.repository import HistoryRepository
from app.llm.gemini_provider import GeminiProvider
from app.llm.mock_provider import MockProvider
from app.llm.provider import DiagnosisProvider
from app.services.symptom_service import SymptomService

logger = logging.getLogger(__name__)

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
MAX_BODY_BYTES = 10_000

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
}


def create_provider(settings: Settings) -> DiagnosisProvider:
    if settings.llm_provider == "gemini":
        return GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_seconds=settings.llm_timeout_seconds,
        )
    return MockProvider(settings.mock_latency_seconds)


def create_app(settings: Settings | None = None, provider: DiagnosisProvider | None = None) -> FastAPI:
    """Composition root. Dependencies can be overridden so tests run fully in-process."""
    settings = settings or get_settings()
    provider = provider or create_provider(settings)
    cache: TtlLruCache[Analysis] = TtlLruCache(
        max_entries=settings.cache_max_entries, ttl_seconds=settings.cache_ttl_seconds
    )
    history = HistoryRepository(settings.db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if settings.llm_provider == "mock":
            logger.info("No GEMINI_API_KEY set - running with the offline mock model (demo mode).")
        else:
            logger.info("Using Gemini model %s", settings.gemini_model)
        yield
        history.close()

    app = FastAPI(title="HealthAI Symptom Checker", lifespan=lifespan, docs_url="/api/docs", redoc_url=None)
    app.state.provider = provider
    app.state.mode = settings.llm_provider
    app.state.cache = cache
    app.state.history = history
    app.state.service = SymptomService(provider=provider, cache=cache, history=history)
    app.state.rate_limiter = SlidingWindowRateLimiter(limit=settings.rate_limit_per_minute, window_seconds=60)

    @app.middleware("http")
    async def limit_body_and_add_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return JSONResponse({"error": {"code": "BAD_REQUEST", "message": "Request is too large."}}, 413)
        response = await call_next(request)
        if not request.url.path.startswith("/api/docs"):
            response.headers.update(SECURITY_HEADERS)
        return response

    register_error_handlers(app)
    app.include_router(router)
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")
    return app
