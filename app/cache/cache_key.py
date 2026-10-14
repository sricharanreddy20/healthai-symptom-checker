import hashlib
import json
import re
import unicodedata

from app.domain.schemas import SymptomInput

_PUNCTUATION = re.compile(r"[^\w\s'-]|_")
_WHITESPACE = re.compile(r"\s+")


def normalize_symptoms(text: str) -> str:
    """Removes cosmetic differences ("Headache,  FEVER." vs "headache fever") so they share a cache entry.

    Word order is kept: reordering can change meaning
    ("pain in chest after running" vs "running after chest pain").
    """
    text = unicodedata.normalize("NFKC", text).lower()
    text = _PUNCTUATION.sub(" ", text)
    return _WHITESPACE.sub(" ", text).strip()


def build_cache_key(symptom_input: SymptomInput, model_id: str, prompt_version: str) -> str:
    canonical = json.dumps(
        [model_id, prompt_version, normalize_symptoms(symptom_input.symptoms), symptom_input.age, symptom_input.sex]
    )
    return hashlib.sha256(canonical.encode()).hexdigest()
