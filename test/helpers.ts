import type { Config } from "../src/config.ts";
import type { Analysis, SymptomInput } from "../src/domain/schemas.ts";
import type { DiagnosisProvider } from "../src/llm/provider.ts";

export const testConfig: Config = {
  port: 0,
  dbPath: ":memory:",
  llm: { provider: "mock", model: "test", effort: "low", timeoutMs: 1000, mockLatencyMs: 0 },
  cache: { maxEntries: 100, ttlMs: 60_000 },
};

export const sampleAnalysis: Analysis = {
  recognizedAsSymptoms: true,
  summary: "Likely a common cold.",
  urgency: "self_care",
  conditions: [
    { name: "Common cold", likelihood: "high", explanation: "Typical symptoms.", matchingSymptoms: ["sore throat"], nextSteps: "Rest." },
  ],
  selfCareTips: ["Drink fluids"],
  seekCareIf: ["Fever above 39C"],
  followUpQuestions: ["When did it start?"],
};

/** Records calls and lets a test control latency and the returned analysis. */
export class FakeProvider implements DiagnosisProvider {
  readonly modelId = "fake-model";
  calls: SymptomInput[] = [];
  delayMs: number;
  result: Analysis | Error;

  constructor(result: Analysis | Error = sampleAnalysis, delayMs = 0) {
    this.result = result;
    this.delayMs = delayMs;
  }

  async analyze(input: SymptomInput): Promise<Analysis> {
    this.calls.push(input);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
