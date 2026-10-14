"""Deterministic emergency screen that runs before (and independently of) the LLM.

A model can be slow, unavailable, or wrong; these phrases always surface a
"call emergency services" banner. Deliberately conservative: false positives
are acceptable, false negatives are not.
"""

import re

_RED_FLAGS: list[tuple[str, re.Pattern[str]]] = [
    (
        "Chest pain or pressure",
        re.compile(r"\bchest\s+(pain|pressure|tightness|tight)\b|\btight(ness)?\s+(in\s+)?(my\s+)?chest\b", re.I),
    ),
    (
        "Difficulty breathing",
        re.compile(
            r"\b(can'?t|cannot|unable to|hard to|difficulty|trouble)\s+breath(e|ing)\b"
            r"|\bshort(ness)? of breath\b|\bgasping\b",
            re.I,
        ),
    ),
    (
        "Signs of stroke",
        re.compile(
            r"\b(face|facial)\s+droop|\bslurred\s+speech\b|\b(sudden\s+)?(numbness|weakness)\s+(on|in)\s+one\s+side\b",
            re.I,
        ),
    ),
    (
        "Severe bleeding",
        re.compile(
            r"\b(heavy|severe|uncontrolled|won'?t stop)\s+bleeding\b|\bbleeding\s+(heavily|won'?t stop)\b"
            r"|\bvomiting\s+blood\b|\bcoughing\s+(up\s+)?blood\b",
            re.I,
        ),
    ),
    (
        "Loss of consciousness",
        re.compile(r"\b(passed out|fainted|unconscious|loss of consciousness|blacked out)\b", re.I),
    ),
    ("Seizure", re.compile(r"seizure|convulsion", re.I)),
    ("Thoughts of self-harm", re.compile(r"\b(suicid\w*|kill myself|end my life|self[- ]harm|hurt myself)\b", re.I)),
    (
        "Severe allergic reaction",
        re.compile(r"\b(anaphyla\w*|throat (is )?(closing|swelling)|swollen (tongue|throat))\b", re.I),
    ),
    ("Worst headache of life", re.compile(r"\bworst headache\b|\bthunderclap\b", re.I)),
]


def detect_red_flags(text: str) -> list[str]:
    return [label for label, pattern in _RED_FLAGS if pattern.search(text)]
