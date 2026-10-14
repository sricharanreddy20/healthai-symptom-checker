import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default("./data/healthai.db"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["anthropic", "mock"]).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MOCK_LATENCY_MS: z.coerce.number().int().nonnegative().default(1500),
});

export type Config = {
  port: number;
  dbPath: string;
  llm: {
    provider: "anthropic" | "mock";
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    timeoutMs: number;
    mockLatencyMs: number;
  };
  cache: { maxEntries: number; ttlMs: number };
};

/** Parses process.env once at startup so misconfiguration fails fast with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `LLM_PROVIDER=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    dbPath: e.DB_PATH,
    llm: {
      provider: e.LLM_PROVIDER ?? (e.ANTHROPIC_API_KEY ? "anthropic" : "mock"),
      model: e.ANTHROPIC_MODEL,
      effort: e.ANTHROPIC_EFFORT,
      timeoutMs: e.LLM_TIMEOUT_MS,
      mockLatencyMs: e.MOCK_LATENCY_MS,
    },
    cache: { maxEntries: e.CACHE_MAX_ENTRIES, ttlMs: e.CACHE_TTL_SECONDS * 1000 },
  };
}
