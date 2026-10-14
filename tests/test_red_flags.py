from app.domain.red_flags import detect_red_flags


def test_flags_emergency_phrases() -> None:
    assert detect_red_flags("I have crushing chest pain and can't breathe") == [
        "Chest pain or pressure",
        "Difficulty breathing",
    ]
    assert detect_red_flags("my face drooping and slurred speech") == ["Signs of stroke"]
    assert detect_red_flags("I want to kill myself") == ["Thoughts of self-harm"]


def test_ignores_ordinary_symptoms() -> None:
    assert detect_red_flags("sore throat and runny nose for two days") == []
    assert detect_red_flags("mild headache after a long day") == []
