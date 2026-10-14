"""Request, LLM-output and response models (the single source of truth for data shapes).

Python code uses snake_case; JSON on the wire uses camelCase, matching the front end.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

SYMPTOMS_MIN_LENGTH = 10
SYMPTOMS_MAX_LENGTH = 1000
_HAS_WORD = re.compile(r"[^\W\d_]{2,}")  # two or more consecutive letters, any alphabet


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- Input ----------


class SymptomInput(CamelModel):
    """What the patient submits. Mirrored by client-side validation in public/app.js."""

    # validate_default so a missing field gets the same friendly message as an empty one.
    symptoms: str = Field(default="", validate_default=True)
    age: int | None = None
    sex: Literal["female", "male", "other"] | None = None

    @field_validator("symptoms", mode="before")
    @classmethod
    def _validate_symptoms(cls, value: Any) -> str:
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise PydanticCustomError("symptoms_type", "Please describe your symptoms as text.")
        text = value.strip()
        if not text:
            raise PydanticCustomError("symptoms_empty", "Please describe your symptoms.")
        if len(text) < SYMPTOMS_MIN_LENGTH:
            raise PydanticCustomError(
                "symptoms_short", f"Please describe your symptoms in at least {SYMPTOMS_MIN_LENGTH} characters."
            )
        if len(text) > SYMPTOMS_MAX_LENGTH:
            raise PydanticCustomError(
                "symptoms_long", f"Please keep your description under {SYMPTOMS_MAX_LENGTH} characters."
            )
        if not _HAS_WORD.search(text):
            raise PydanticCustomError("symptoms_words", "Please describe your symptoms in words.")
        return text

    @field_validator("age")
    @classmethod
    def _validate_age(cls, value: int | None) -> int | None:
        if value is not None and not 0 <= value <= 120:
            raise PydanticCustomError("age_range", "Please enter an age between 0 and 120.")
        return value


# ---------- LLM output ----------

Urgency = Literal["self_care", "see_doctor", "urgent_care", "emergency"]


class Condition(CamelModel):
    name: str
    likelihood: Literal["high", "moderate", "low"]
    explanation: str = Field(description="Why this fits, in plain language")
    matching_symptoms: list[str]
    next_steps: str


class Analysis(CamelModel):
    """Structured output the model must return. Sent to Gemini as a JSON schema."""

    recognized_as_symptoms: bool = Field(
        description="false if the input does not describe health symptoms (e.g. gibberish or an unrelated question)"
    )
    summary: str = Field(description="One or two plain-language sentences summarising the picture")
    urgency: Urgency
    conditions: list[Condition] = Field(
        description="2-5 potential conditions, most likely first; empty if recognizedAsSymptoms is false"
    )
    self_care_tips: list[str]
    seek_care_if: list[str] = Field(description="Warning signs that should prompt the patient to seek care")
    follow_up_questions: list[str] = Field(description="Questions a clinician would ask next")


# ---------- API response ----------


class DiagnosisMeta(CamelModel):
    cached: bool
    latency_ms: int
    model: str


class DiagnosisRecord(CamelModel):
    id: str
    created_at: str
    input: SymptomInput
    analysis: Analysis
    red_flags: list[str]
    meta: DiagnosisMeta
