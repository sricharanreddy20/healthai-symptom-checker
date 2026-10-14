from typing import Protocol

from app.domain.schemas import Analysis, SymptomInput


class DiagnosisProvider(Protocol):
    """Anything that can turn symptoms into a structured analysis.

    The service layer depends only on this interface, so the real model and the
    offline mock are interchangeable (and tests never hit the network).
    """

    @property
    def model_id(self) -> str:
        """Identifies the model; part of the cache key so switching models never serves stale results."""
        ...

    async def analyze(self, symptom_input: SymptomInput) -> Analysis: ...
