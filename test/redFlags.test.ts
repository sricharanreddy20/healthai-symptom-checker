import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectRedFlags } from "../src/domain/redFlags.ts";

describe("detectRedFlags", () => {
  it("flags emergency phrases", () => {
    assert.deepEqual(detectRedFlags("I have crushing chest pain and can't breathe"), ["Chest pain or pressure", "Difficulty breathing"]);
    assert.deepEqual(detectRedFlags("my face drooping and slurred speech"), ["Signs of stroke"]);
    assert.deepEqual(detectRedFlags("I want to kill myself"), ["Thoughts of self-harm"]);
  });

  it("does not flag ordinary symptoms", () => {
    assert.deepEqual(detectRedFlags("sore throat and runny nose for two days"), []);
    assert.deepEqual(detectRedFlags("mild headache after a long day"), []);
  });
});
