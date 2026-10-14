import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, mapSdkError } from "../src/llm/anthropicProvider.ts";
import { LlmFailedError, LlmUnavailableError } from "../src/errors.ts";
import { sampleAnalysis } from "./helpers.ts";

/** Minimal stand-in for the SDK client: only beta.messages.parse is used. */
function fakeClient(parse: (params: any) => Promise<unknown>): Anthropic {
  return { beta: { messages: { parse } } } as unknown as Anthropic;
}

const opts = { model: "claude-opus-5-5", effort: "medium" as const, timeoutMs: 1000 };

describe("AnthropicProvider", () => {
  it("sends a structured-output request and returns the parsed analysis", async () => {
    let sent: any;
    const provider = new AnthropicProvider({
      ...opts,
      client: fakeClient(async (params) => {
        sent = params;
        return { stop_reason: "end_turn", parsed_output: sampleAnalysis };
      }),
    });
    const result = await provider.analyze({ symptoms: "sore throat and fever", age: 30 });
    assert.deepEqual(result, sampleAnalysis);
    assert.equal(sent.model, "claude-opus-5-5");
    assert.equal(sent.output_config.effort, "medium");
    assert.equal(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /<symptoms>\nsore throat and fever\n<\/symptoms>\nAge: 30/);
  });

  it("treats refusals, truncation and unparsable output as failures", async () => {
    for (const response of [
      { stop_reason: "refusal", parsed_output: null },
      { stop_reason: "max_tokens", parsed_output: null },
      { stop_reason: "end_turn", parsed_output: null },
    ]) {
      const provider = new AnthropicProvider({ ...opts, client: fakeClient(async () => response) });
      await assert.rejects(provider.analyze({ symptoms: "sore throat and fever" }), LlmFailedError);
    }
  });
});

describe("mapSdkError", () => {
  const headers = new Headers();

  it("maps retryable failures to 503/504", () => {
    const rateLimited = mapSdkError(new Anthropic.RateLimitError(429, undefined, "rate limited", headers));
    assert.ok(rateLimited instanceof LlmUnavailableError);
    assert.equal((rateLimited as LlmUnavailableError).status, 503);

    const timeout = mapSdkError(new Anthropic.APIConnectionTimeoutError());
    assert.equal((timeout as LlmUnavailableError).status, 504);

    const overloaded = mapSdkError(new Anthropic.InternalServerError(529, undefined, "overloaded", headers));
    assert.ok(overloaded instanceof LlmUnavailableError);
  });

  it("maps configuration and request errors to 502 without leaking details", () => {
    const auth = mapSdkError(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", headers));
    assert.ok(auth instanceof LlmFailedError);
    assert.doesNotMatch(auth.message, /x-api-key/);
    assert.ok(mapSdkError(new Anthropic.BadRequestError(400, undefined, "bad", headers)) instanceof LlmFailedError);
  });

  it("maps output that fails schema validation to 502", () => {
    const err = new Anthropic.AnthropicError("Failed to parse structured output: invalid enum");
    assert.ok(mapSdkError(err) instanceof LlmFailedError);
  });

  it("passes through unknown errors", () => {
    const err = new TypeError("boom");
    assert.equal(mapSdkError(err), err);
  });
});
