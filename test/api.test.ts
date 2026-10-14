import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.ts";
import { FakeProvider, sampleAnalysis, testConfig } from "./helpers.ts";

describe("HTTP API", () => {
  let app: ReturnType<typeof createApp>["app"];
  let provider: FakeProvider;
  const client = randomUUID();

  beforeEach(() => {
    provider = new FakeProvider(sampleAnalysis, 100);
    ({ app } = createApp(testConfig, { provider }));
  });

  const post = (body: unknown, id = client) =>
    request(app).post("/api/diagnoses").set("X-Client-Id", id).send(body as object);

  it("returns potential diagnoses for valid symptoms", async () => {
    const res = await post({ symptoms: "Sore throat and fever since yesterday" }).expect(201);
    assert.equal(res.body.analysis.conditions[0].name, "Common cold");
    assert.equal(res.body.meta.cached, false);
    assert.equal(provider.calls[0]?.symptoms, "Sore throat and fever since yesterday");
  });

  it("rejects empty input with a readable error and never calls the model", async () => {
    const res = await post({ symptoms: "" }).expect(400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.equal(res.body.error.message, "Please describe your symptoms.");
    assert.equal(provider.calls.length, 0);
  });

  it("rejects input below the minimum length", async () => {
    const res = await post({ symptoms: "cough" }).expect(400);
    assert.match(res.body.error.message, /at least 10 characters/);
  });

  it("rejects malformed JSON and missing client ids", async () => {
    const bad = await request(app).post("/api/diagnoses").set("X-Client-Id", client)
      .set("Content-Type", "application/json").send("{not json").expect(400);
    assert.equal(bad.body.error.code, "BAD_REQUEST");
    await request(app).post("/api/diagnoses").send({ symptoms: "sore throat and fever" }).expect(400);
  });

  it("answers a repeated query from cache, faster", async () => {
    const first = await post({ symptoms: "sore throat and fever" }).expect(201);
    const second = await post({ symptoms: "Sore throat and fever." }).expect(201);
    assert.equal(second.body.meta.cached, true);
    assert.ok(second.body.meta.latencyMs < first.body.meta.latencyMs);
    assert.equal(provider.calls.length, 1);
    const stats = await request(app).get("/api/cache/stats").expect(200);
    assert.equal(stats.body.hits, 1);
  });

  it("lists history newest first, scoped to the client", async () => {
    const a = await post({ symptoms: "sore throat and fever" }).expect(201);
    const b = await post({ symptoms: "headache for three days" }).expect(201);
    await post({ symptoms: "someone else's back pain" }, randomUUID()).expect(201);

    const res = await request(app).get("/api/history").set("X-Client-Id", client).expect(200);
    assert.deepEqual(res.body.items.map((i: { id: string }) => i.id), [b.body.id, a.body.id]);
    assert.equal(res.body.items[1].input.symptoms, "sore throat and fever");
    assert.equal(res.body.items[1].analysis.summary, sampleAnalysis.summary);

    await request(app).get(`/api/history/${a.body.id}`).set("X-Client-Id", client).expect(200);
    await request(app).get(`/api/history/${a.body.id}`).set("X-Client-Id", randomUUID()).expect(404);
  });

  it("clears history", async () => {
    await post({ symptoms: "sore throat and fever" }).expect(201);
    const res = await request(app).delete("/api/history").set("X-Client-Id", client).expect(200);
    assert.equal(res.body.deleted, 1);
    const list = await request(app).get("/api/history").set("X-Client-Id", client).expect(200);
    assert.deepEqual(list.body.items, []);
  });

  it("returns 422 when the model finds no symptoms", async () => {
    provider.result = { ...sampleAnalysis, recognizedAsSymptoms: false, conditions: [] };
    const res = await post({ symptoms: "please write me a poem" }).expect(422);
    assert.equal(res.body.error.code, "UNRECOGNIZED_SYMPTOMS");
  });

  it("hides unexpected internal errors", async () => {
    provider.result = new Error("database password is hunter2");
    const res = await post({ symptoms: "sore throat and fever" }).expect(500);
    assert.equal(res.body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(res.body), /hunter2/);
  });

  it("serves the UI and returns JSON 404s for unknown API routes", async () => {
    await request(app).get("/").expect(200).expect("Content-Type", /html/);
    const res = await request(app).get("/api/nope").expect(404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });
});
