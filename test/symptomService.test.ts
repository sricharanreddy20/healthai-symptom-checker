import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { TtlLruCache } from "../src/cache/ttlLruCache.ts";
import type { Analysis } from "../src/domain/schemas.ts";
import { AppError, LlmUnavailableError, UnrecognizedSymptomsError } from "../src/errors.ts";
import { HistoryRepository } from "../src/history/historyRepository.ts";
import { SymptomService } from "../src/services/symptomService.ts";
import { FakeProvider, sampleAnalysis } from "./helpers.ts";

const CLIENT = "11111111-1111-4111-8111-111111111111";

describe("SymptomService", () => {
  let provider: FakeProvider;
  let history: HistoryRepository;
  let service: SymptomService;

  beforeEach(() => {
    provider = new FakeProvider(sampleAnalysis, 50);
    history = new HistoryRepository(":memory:");
    service = new SymptomService({ provider, history, cache: new TtlLruCache<Analysis>({ maxEntries: 10, ttlMs: 60_000 }) });
  });

  it("returns the analysis and saves it to history", async () => {
    const record = await service.check(CLIENT, { symptoms: "sore throat and fever" });
    assert.deepEqual(record.analysis, sampleAnalysis);
    assert.equal(record.meta.cached, false);
    assert.deepEqual(history.list(CLIENT, 10).map((r) => r.id), [record.id]);
  });

  it("serves a repeated query from cache without calling the model", async () => {
    const first = await service.check(CLIENT, { symptoms: "Sore throat and fever" });
    const second = await service.check(CLIENT, { symptoms: "sore throat, and fever." });
    assert.equal(provider.calls.length, 1);
    assert.equal(second.meta.cached, true);
    assert.ok(second.meta.latencyMs < first.meta.latencyMs);
    assert.equal(history.list(CLIENT, 10).length, 2);
  });

  it("coalesces concurrent identical requests into one model call", async () => {
    await Promise.all([
      service.check(CLIENT, { symptoms: "sore throat and fever" }),
      service.check(CLIENT, { symptoms: "sore throat and fever" }),
    ]);
    assert.equal(provider.calls.length, 1);
  });

  it("rejects input the model does not recognise as symptoms", async () => {
    provider.result = { ...sampleAnalysis, recognizedAsSymptoms: false, conditions: [] };
    await assert.rejects(service.check(CLIENT, { symptoms: "what is the capital of France" }), UnrecognizedSymptomsError);
    assert.equal(history.list(CLIENT, 10).length, 0);
  });

  it("does not cache failures", async () => {
    provider.result = new LlmUnavailableError();
    await assert.rejects(service.check(CLIENT, { symptoms: "sore throat and fever" }), LlmUnavailableError);
    provider.result = sampleAnalysis;
    const record = await service.check(CLIENT, { symptoms: "sore throat and fever" });
    assert.equal(record.meta.cached, false);
  });

  it("keeps red-flag warnings on errors when the model is down", async () => {
    provider.result = new LlmUnavailableError();
    await assert.rejects(service.check(CLIENT, { symptoms: "sudden chest pain at rest" }), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 503);
      assert.deepEqual(err.details, { redFlags: ["Chest pain or pressure"] });
      return true;
    });
  });
});
