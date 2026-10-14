import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { TtlLruCache } from "./cache/ttlLruCache.ts";
import type { Config } from "./config.ts";
import type { Analysis } from "./domain/schemas.ts";
import { HistoryRepository } from "./history/historyRepository.ts";
import { errorHandler, notFoundHandler } from "./http/errorHandler.ts";
import { apiRouter } from "./http/routes.ts";
import { AnthropicProvider } from "./llm/anthropicProvider.ts";
import { MockProvider } from "./llm/mockProvider.ts";
import type { DiagnosisProvider } from "./llm/provider.ts";
import { SymptomService } from "./services/symptomService.ts";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createProvider(llm: Config["llm"]): DiagnosisProvider {
  return llm.provider === "anthropic"
    ? new AnthropicProvider({ model: llm.model, effort: llm.effort, timeoutMs: llm.timeoutMs })
    : new MockProvider(llm.mockLatencyMs);
}

/** Composition root. Dependencies can be overridden so tests run fully in-process. */
export function createApp(config: Config, overrides: { provider?: DiagnosisProvider } = {}) {
  const provider = overrides.provider ?? createProvider(config.llm);
  const cache = new TtlLruCache<Analysis>(config.cache);
  const history = new HistoryRepository(config.dbPath);
  const service = new SymptomService({ provider, cache, history });

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "10kb" }));
  app.use(
    "/api",
    apiRouter({ service, history, cache, provider: { modelId: provider.modelId, mode: config.llm.provider } }),
  );
  app.use("/api", notFoundHandler);
  app.use(express.static(publicDir));
  app.use(errorHandler);

  return { app, history, cache };
}
