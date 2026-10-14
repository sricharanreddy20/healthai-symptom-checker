from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads settings from the environment and .env once at startup, so misconfiguration fails fast."""

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    port: int = Field(default=8000, gt=0)
    db_path: str = "./data/healthai.db"

    gemini_api_key: str | None = None
    llm_provider: Literal["gemini", "mock"] | None = None
    gemini_model: str = "gemini-3.5-flash"
    # Comma-separated models tried in order when the primary is overloaded or times out.
    gemini_fallback_models: str = "gemini-3.1-flash-lite"
    llm_timeout_seconds: float = Field(default=45, gt=0)
    mock_latency_seconds: float = Field(default=1.5, ge=0)

    cache_max_entries: int = Field(default=500, gt=0)
    cache_ttl_seconds: float = Field(default=3600, gt=0)

    rate_limit_per_minute: int = Field(default=20, gt=0)

    @property
    def fallback_models(self) -> list[str]:
        return [m.strip() for m in self.gemini_fallback_models.split(",") if m.strip()]

    @model_validator(mode="after")
    def _default_provider(self) -> "Settings":
        # Use Gemini when a key is present, otherwise fall back to the offline mock.
        if self.llm_provider is None:
            self.llm_provider = "gemini" if self.gemini_api_key else "mock"
        if self.llm_provider == "gemini" and not self.gemini_api_key:
            raise ValueError("LLM_PROVIDER=gemini requires GEMINI_API_KEY")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
