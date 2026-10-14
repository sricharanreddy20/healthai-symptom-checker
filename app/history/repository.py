import json
import sqlite3
import threading
from pathlib import Path

from app.domain.schemas import Analysis, DiagnosisMeta, DiagnosisRecord, SymptomInput

_SCHEMA = """
CREATE TABLE IF NOT EXISTS submissions (
    id             TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    input_json     TEXT NOT NULL,
    analysis_json  TEXT NOT NULL,
    red_flags_json TEXT NOT NULL,
    cached         INTEGER NOT NULL,
    latency_ms     INTEGER NOT NULL,
    model          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_client_created
    ON submissions (client_id, created_at DESC);
"""


class HistoryRepository:
    """Persists submissions in SQLite (Python's built-in driver).

    Every query is scoped to the anonymous client id, so one browser never sees
    another browser's history. Queries are tiny, so they run inline on the event
    loop; a lock makes the shared connection safe across threads.
    """

    def __init__(self, path: str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._conn:
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.executescript(_SCHEMA)

    def save(self, client_id: str, record: DiagnosisRecord) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT INTO submissions
                   (id, client_id, created_at, input_json, analysis_json, red_flags_json, cached, latency_ms, model)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    record.id,
                    client_id,
                    record.created_at,
                    record.input.model_dump_json(),
                    record.analysis.model_dump_json(),
                    json.dumps(record.red_flags),
                    int(record.meta.cached),
                    record.meta.latency_ms,
                    record.meta.model,
                ),
            )

    def list(self, client_id: str, limit: int) -> list[DiagnosisRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM submissions WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (client_id, limit),
            ).fetchall()
        return [_to_record(row) for row in rows]

    def get(self, client_id: str, record_id: str) -> DiagnosisRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM submissions WHERE client_id = ? AND id = ?", (client_id, record_id)
            ).fetchone()
        return _to_record(row) if row else None

    def clear(self, client_id: str) -> int:
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM submissions WHERE client_id = ?", (client_id,)).rowcount

    def close(self) -> None:
        self._conn.close()


def _to_record(row: sqlite3.Row) -> DiagnosisRecord:
    return DiagnosisRecord(
        id=row["id"],
        created_at=row["created_at"],
        input=SymptomInput.model_validate_json(row["input_json"]),
        analysis=Analysis.model_validate_json(row["analysis_json"]),
        red_flags=json.loads(row["red_flags_json"]),
        meta=DiagnosisMeta(cached=bool(row["cached"]), latency_ms=row["latency_ms"], model=row["model"]),
    )
