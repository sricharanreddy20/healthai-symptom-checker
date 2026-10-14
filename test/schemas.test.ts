import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SymptomInputSchema } from "../src/domain/schemas.ts";

describe("SymptomInputSchema", () => {
  const msg = (input: unknown) => {
    const r = SymptomInputSchema.safeParse(input);
    return r.success ? null : r.error.issues[0]?.message;
  };

  it("rejects missing, empty and whitespace-only symptoms", () => {
    assert.equal(msg({}), "Please describe your symptoms.");
    assert.equal(msg({ symptoms: "" }), "Please describe your symptoms.");
    assert.equal(msg({ symptoms: "     " }), "Please describe your symptoms.");
  });

  it("enforces the minimum length after trimming", () => {
    assert.match(msg({ symptoms: "  headache  " })!, /at least 10 characters/);
    assert.equal(msg({ symptoms: "bad headache" }), null);
  });

  it("enforces the maximum length", () => {
    assert.match(msg({ symptoms: "a".repeat(1001) })!, /under 1000/);
  });

  it("rejects input with no words", () => {
    assert.equal(msg({ symptoms: "1234567890 !!!" }), "Please describe your symptoms in words.");
  });

  it("validates optional age and sex", () => {
    assert.equal(msg({ symptoms: "sore throat for days", age: 34, sex: "female" }), null);
    assert.ok(msg({ symptoms: "sore throat for days", age: 300 }));
    assert.ok(msg({ symptoms: "sore throat for days", sex: "unknown" }));
  });

  it("trims the symptoms it returns", () => {
    assert.equal(SymptomInputSchema.parse({ symptoms: "  sore throat  " }).symptoms, "sore throat");
  });
});
