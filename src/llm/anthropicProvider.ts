import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnalysisSchema, type Analysis, type SymptomInput } from "../domain/schemas.ts";
import { LlmFailedError, LlmUnavailableError } from "../errors.ts";
import { SYSTEM_PROMPT, renderUserMessage } from "./prompt.ts";
import type { DiagnosisProvider } from "./provider.ts";

type Options = {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs: number;
  client?: Anthropic;
};

/** Calls Claude with structured outputs so the response always matches AnalysisSchema. */
export class AnthropicProvider implements DiagnosisProvider {
  readonly modelId: string;
  private readonly effort: Options["effort"];
  private readonly client: Anthropic;

  constructor(opts: Options) {
    this.modelId = opts.model;
    this.effort = opts.effort;
    // The SDK retries 408/409/429/5xx and connection errors twice with backoff.
    this.client = opts.client ?? new Anthropic({ timeout: opts.timeoutMs, maxRetries: 2 });
  }

  async analyze(input: SymptomInput): Promise<Analysis> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.modelId,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: renderUserMessage(input) }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(AnalysisSchema) },
        // If a safety classifier declines, the API re-runs the request on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      throw mapSdkError(err);
    }

    if (response.stop_reason === "refusal") {
      console.warn("[llm] request refused", response.stop_details?.category ?? "unknown");
      throw new LlmFailedError("We couldn't analyse that description. Please rephrase it and try again.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmFailedError("The analysis was cut short. Please try a shorter description.");
    }
    if (!response.parsed_output) {
      throw new LlmFailedError();
    }
    return response.parsed_output;
  }
}

/** Translates SDK errors into patient-safe AppErrors, most specific first. */
export function mapSdkError(err: unknown): Error {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmUnavailableError("The analysis took too long. Please try again.", 504);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmUnavailableError();
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error("[llm] credentials rejected - check ANTHROPIC_API_KEY");
    return new LlmFailedError("The analysis service is not configured correctly. Please contact support.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmUnavailableError();
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`[llm] API error ${err.status}: ${err.message}`);
    return err.status !== undefined && err.status >= 500 ? new LlmUnavailableError() : new LlmFailedError();
  }
  if (err instanceof Anthropic.AnthropicError) {
    // e.g. the model's JSON didn't satisfy AnalysisSchema.
    console.error(`[llm] ${err.message}`);
    return new LlmFailedError();
  }
  return err instanceof Error ? err : new Error(String(err));
}
