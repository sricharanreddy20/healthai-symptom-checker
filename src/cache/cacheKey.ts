import { createHash } from "node:crypto";
import type { SymptomInput } from "../domain/schemas.ts";

/**
 * Normalises cosmetic differences ("Headache,  FEVER." vs "headache, fever")
 * so they share a cache entry. Word order is kept: reordering can change
 * meaning ("pain in chest after running" vs "running after chest pain").
 */
export function normalizeSymptoms(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCacheKey(input: SymptomInput, modelId: string, promptVersion: string): string {
  const canonical = JSON.stringify([
    modelId,
    promptVersion,
    normalizeSymptoms(input.symptoms),
    input.age ?? null,
    input.sex ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
