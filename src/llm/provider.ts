import type { Analysis, SymptomInput } from "../domain/schemas.ts";

/**
 * Anything that can turn symptoms into a structured analysis. The service layer
 * depends only on this interface, so the real model and the offline mock are
 * interchangeable (and tests never hit the network).
 */
export interface DiagnosisProvider {
  /** Identifies the model; part of the cache key so switching models never serves stale results. */
  readonly modelId: string;
  analyze(input: SymptomInput): Promise<Analysis>;
}
