# Demo video outline (target: 6–7 min, webcam on)

1. **Intro (30 s).** Who you are and what HealthAI is. Show the repo and README briefly.
2. **Run it (30 s).** `source .venv/bin/activate && python -m app`, mention demo mode vs. `GEMINI_API_KEY`.
3. **Symptom input + validation (1 min).** Submit empty → error. Type "cough" → min-length error. Show the live character counter.
4. **LLM diagnoses (1.5 min).** Submit "Sore throat and a mild fever since yesterday, runny nose and feeling tired" with age. Walk through urgency badge, conditions, next steps. Open `app/llm/gemini_provider.py` and point at the JSON schema output + error mapping.
5. **Caching (1 min).** Submit the same text again (try different capitalisation/punctuation) → "From cache in <1 ms". Show `/api/cache/stats`. Explain key normalisation and why not semantic caching.
6. **History (45 s).** Open History, expand an entry, mention per-browser scoping and Clear history.
7. **Safety (30 s).** Submit "sudden chest pain and shortness of breath" → emergency banner from the deterministic red-flag screen.
8. **Mobile (30 s).** Browser dev tools → phone width, no horizontal scroll.
9. **Wrap-up (45 s).** Architecture diagram + trade-offs in README, `pytest`, AI usage section, what you'd do next.
