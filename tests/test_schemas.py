import pytest
from pydantic import ValidationError

from app.domain.schemas import SymptomInput


def error_message(data: dict[str, object]) -> str | None:
    try:
        SymptomInput.model_validate(data)
    except ValidationError as exc:
        return str(exc.errors()[0]["msg"])
    return None


@pytest.mark.parametrize("data", [{}, {"symptoms": ""}, {"symptoms": "     "}, {"symptoms": None}])
def test_rejects_missing_or_empty_symptoms(data: dict[str, object]) -> None:
    assert error_message(data) == "Please describe your symptoms."


def test_enforces_minimum_length_after_trimming() -> None:
    assert "at least 10 characters" in (error_message({"symptoms": "  headache  "}) or "")
    assert error_message({"symptoms": "bad headache"}) is None


def test_enforces_maximum_length() -> None:
    assert "under 1000" in (error_message({"symptoms": "a" * 1001}) or "")


def test_rejects_input_without_words() -> None:
    assert error_message({"symptoms": "1234567890 !!!"}) == "Please describe your symptoms in words."


def test_validates_optional_age_and_sex() -> None:
    assert error_message({"symptoms": "sore throat for days", "age": 34, "sex": "female"}) is None
    assert error_message({"symptoms": "sore throat for days", "age": 300}) == "Please enter an age between 0 and 120."
    assert error_message({"symptoms": "sore throat for days", "sex": "unknown"}) is not None


def test_trims_symptoms() -> None:
    assert SymptomInput(symptoms="  sore throat  ").symptoms == "sore throat"
