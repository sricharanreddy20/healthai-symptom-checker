import { randomUUID } from "node:crypto";
import { buildCacheKey } from "../cache/cacheKey.ts";
import type { TtlLruCache } from "../cache/ttlLruCache.ts";
import { detectRedFlags } from "../domain/redFlags.ts";
import type { Analysis, DiagnosisRecord, SymptomInput } from "../domain/schemas.ts";
import { AppError, UnrecognizedSymptomsError } from "../errors.ts";
import type { HistoryRepository } from "../history/historyRepository.ts";
import { PROMPT_VERSION } from "../llm/prompt.ts";
import type { DiagnosisProvider } from "../llm/provider.ts";

type Deps = {
  provider: DiagnosisProvider;
  cache: TtlLruCache<Analysis>;
  history: HistoryRepository;
  now?: () => number;
};

/**
 * Orchestrates one symptom check: red-flag screen -> cache -> LLM -> history.
 * Input is assumed to be validated already (see http/routes.ts).
 */
export class SymptomService {
  private readonly deps: Deps;
  private readonly now: () => number;
  /** Identical requests that arrive while the first is still running share one LLM call. */
  private readonly inFlight = new Map<string, Promise<Analysis>>();

  constructor(deps: Deps) {
    this.deps = deps;
    this.now = deps.now ?? performance.now.bind(performance);
  }

  async check(clientId: string, input: SymptomInput): Promise<DiagnosisRecord> {
    const started = this.now();
    const { provider, cache, history } = this.deps;
    const key = buildCacheKey(input, provider.modelId, PROMPT_VERSION);
    const redFlags = detectRedFlags(input.symptoms);

    let analysis = cache.get(key);
    const cached = analysis !== undefined;
    if (!analysis) {
      try {
        analysis = await this.analyzeOnce(key, input);
      } catch (err) {
        // Emergency warnings must reach the patient even when the model is down.
        if (err instanceof AppError && redFlags.length > 0) {
          throw new AppError(err.status, err.code, err.message, { redFlags });
        }
        throw err;
      }
    }
    if (!analysis.recognizedAsSymptoms) {
      throw new UnrecognizedSymptomsError();
    }

    const record: DiagnosisRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      input,
      analysis,
      redFlags,
      meta: { cached, latencyMs: Math.round(this.now() - started), model: provider.modelId },
    };
    history.save(clientId, record);
    return record;
  }

  private analyzeOnce(key: string, input: SymptomInput): Promise<Analysis> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.deps.provider
      .analyze(input)
      .then((analysis) => {
        // Unrecognised input is cached too, so repeated junk doesn't cost an LLM call each time.
        this.deps.cache.set(key, analysis);
        return analysis;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
