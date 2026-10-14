import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { TtlLruCache } from "../cache/ttlLruCache.ts";
import { SymptomInputSchema, type Analysis } from "../domain/schemas.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import type { HistoryRepository } from "../history/historyRepository.ts";
import type { SymptomService } from "../services/symptomService.ts";

type Deps = {
  service: SymptomService;
  history: HistoryRepository;
  cache: TtlLruCache<Analysis>;
  provider: { modelId: string; mode: "anthropic" | "mock" };
};

const ClientIdSchema = z.uuid();
const HistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/**
 * There are no accounts: each browser generates a random id (stored in
 * localStorage) and sends it on every request to scope its own history.
 */
function clientId(req: Request): string {
  const parsed = ClientIdSchema.safeParse(req.get("x-client-id"));
  if (!parsed.success) throw new ValidationError("Missing or invalid X-Client-Id header.");
  return parsed.data;
}

export function apiRouter({ service, history, cache, provider }: Deps): Router {
  const router = Router();

  // LLM calls cost money; cap them per IP.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." } },
  });

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", model: provider.modelId, mode: provider.mode });
  });

  router.post("/diagnoses", analyzeLimiter, async (req, res) => {
    const id = clientId(req);
    const parsed = SymptomInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ValidationError(first?.message ?? "Invalid input.", z.flattenError(parsed.error).fieldErrors);
    }
    const record = await service.check(id, parsed.data);
    res.status(201).json(record);
  });

  router.get("/history", (req, res) => {
    const { limit } = HistoryQuerySchema.parse(req.query);
    res.json({ items: history.list(clientId(req), limit) });
  });

  router.get("/history/:id", (req, res) => {
    const record = history.get(clientId(req), req.params.id);
    if (!record) throw new NotFoundError("That submission was not found.");
    res.json(record);
  });

  router.delete("/history", (req, res) => {
    res.json({ deleted: history.clear(clientId(req)) });
  });

  router.get("/cache/stats", (_req, res) => {
    res.json(cache.stats());
  });

  return router;
}
