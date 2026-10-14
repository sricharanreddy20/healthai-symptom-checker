import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DiagnosisRecord } from "../domain/schemas.ts";

type Row = {
  id: string;
  created_at: string;
  input_json: string;
  analysis_json: string;
  red_flags_json: string;
  cached: number;
  latency_ms: number;
  model: string;
};

/**
 * Persists submissions in SQLite (Node's built-in driver, so there is no native
 * dependency to compile). Every query is scoped to the anonymous client id, so
 * one browser never sees another browser's history.
 */
export class HistoryRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    `);
  }

  save(clientId: string, record: DiagnosisRecord): void {
    this.db
      .prepare(
        `INSERT INTO submissions (id, client_id, created_at, input_json, analysis_json, red_flags_json, cached, latency_ms, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        clientId,
        record.createdAt,
        JSON.stringify(record.input),
        JSON.stringify(record.analysis),
        JSON.stringify(record.redFlags),
        record.meta.cached ? 1 : 0,
        record.meta.latencyMs,
        record.meta.model,
      );
  }

  list(clientId: string, limit: number): DiagnosisRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM submissions WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(clientId, limit) as Row[];
    return rows.map(toRecord);
  }

  get(clientId: string, id: string): DiagnosisRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM submissions WHERE client_id = ? AND id = ?`)
      .get(clientId, id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  clear(clientId: string): number {
    return Number(this.db.prepare(`DELETE FROM submissions WHERE client_id = ?`).run(clientId).changes);
  }

  close(): void {
    this.db.close();
  }
}

function toRecord(row: Row): DiagnosisRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    input: JSON.parse(row.input_json),
    analysis: JSON.parse(row.analysis_json),
    redFlags: JSON.parse(row.red_flags_json),
    meta: { cached: row.cached === 1, latencyMs: row.latency_ms, model: row.model },
  };
}
