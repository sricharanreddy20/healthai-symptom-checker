import asyncio
import re
from dataclasses import dataclass

from app.domain.schemas import Analysis, Condition, SymptomInput, Urgency


@dataclass(frozen=True)
class _Rule:
    keywords: re.Pattern[str]
    condition: Condition
    urgency: Urgency


_RULES = [
    _Rule(
        re.compile(r"\b(fever|chills|body ?aches?|fatigue)\b", re.I),
        Condition(
            name="Influenza (flu)",
            likelihood="moderate",
            explanation="Fever with aches and tiredness is a classic flu pattern.",
            matching_symptoms=["fever", "body aches", "fatigue"],
            next_steps="Rest, fluids, and a doctor visit if you are in a high-risk group.",
        ),
        "see_doctor",
    ),
    _Rule(
        re.compile(r"\b(sore throat|runny nose|cough|sneez\w*|congest\w*)\b", re.I),
        Condition(
            name="Common cold",
            likelihood="high",
            explanation="Throat and nose symptoms without severe illness usually point to a viral cold.",
            matching_symptoms=["sore throat", "runny nose", "cough"],
            next_steps="Rest and fluids; symptoms usually clear within 7-10 days.",
        ),
        "self_care",
    ),
    _Rule(
        re.compile(r"\b(headache|migraine|light sensitivity)\b", re.I),
        Condition(
            name="Tension headache",
            likelihood="moderate",
            explanation="Most headaches are tension-type, linked to stress, posture or poor sleep.",
            matching_symptoms=["headache"],
            next_steps="Rest, hydration and over-the-counter pain relief as directed.",
        ),
        "self_care",
    ),
    _Rule(
        re.compile(r"\b(nausea|vomit\w*|diarrh\w*|stomach|abdominal)\b", re.I),
        Condition(
            name="Viral gastroenteritis",
            likelihood="moderate",
            explanation="Stomach upset with nausea or diarrhoea is often a short-lived stomach bug.",
            matching_symptoms=["nausea", "diarrhoea"],
            next_steps="Small sips of fluid often; see a doctor if you cannot keep fluids down.",
        ),
        "self_care",
    ),
    _Rule(
        re.compile(r"\b(chest pain|chest pressure|short(ness)? of breath)\b", re.I),
        Condition(
            name="Possible heart or lung problem",
            likelihood="moderate",
            explanation="Chest pain or breathlessness needs urgent assessment to rule out serious causes.",
            matching_symptoms=["chest pain"],
            next_steps="Call emergency services now.",
        ),
        "emergency",
    ),
]

_URGENCY_ORDER: list[Urgency] = ["self_care", "see_doctor", "urgent_care", "emergency"]
_LIKELIHOOD_ORDER = ["high", "moderate", "low"]
_GENERIC_SYMPTOM = re.compile(r"\b(pain|ache|hurt|sore|itch|swell\w*|rash|tired|dizz\w*)\b", re.I)


class MockProvider:
    """Keyword-based stand-in for the LLM.

    Lets the app run, demo and test with no API key; the artificial delay makes
    the cache speed-up observable offline.
    """

    def __init__(self, latency_seconds: float = 0) -> None:
        self._latency_seconds = latency_seconds

    @property
    def model_id(self) -> str:
        return "mock-model"

    async def analyze(self, symptom_input: SymptomInput) -> Analysis:
        if self._latency_seconds > 0:
            await asyncio.sleep(self._latency_seconds)

        matches = sorted(
            (r for r in _RULES if r.keywords.search(symptom_input.symptoms)),
            key=lambda r: _LIKELIHOOD_ORDER.index(r.condition.likelihood),
        )
        if not matches:
            return Analysis(
                recognized_as_symptoms=bool(_GENERIC_SYMPTOM.search(symptom_input.symptoms)),
                summary="(Demo mode) Your description didn't match the mock model's small rule set.",
                urgency="see_doctor",
                conditions=[],
                self_care_tips=[],
                seek_care_if=["Symptoms get worse or don't improve within a few days"],
                follow_up_questions=[],
            )

        urgency = max((m.urgency for m in matches), key=_URGENCY_ORDER.index)
        return Analysis(
            recognized_as_symptoms=True,
            summary=f"(Demo mode) Your symptoms are most consistent with {matches[0].condition.name.lower()}.",
            urgency=urgency,
            conditions=[m.condition for m in matches],
            self_care_tips=["Rest and stay hydrated", "Track how your symptoms change over the next 48 hours"],
            seek_care_if=["Symptoms last more than a week", "You develop a high fever or trouble breathing"],
            follow_up_questions=["When did the symptoms start?", "Have you taken any medication for them?"],
        )
