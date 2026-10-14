import { z } from "zod";

export const SYMPTOMS_MIN_LENGTH = 10;
export const SYMPTOMS_MAX_LENGTH = 1000;

/** What the patient submits. Mirrored by client-side validation in public/app.js. */
export const SymptomInputSchema = z.object({
  symptoms: z
    .string({ error: "Please describe your symptoms." })
    .trim()
    .min(1, "Please describe your symptoms.")
    .min(SYMPTOMS_MIN_LENGTH, `Please describe your symptoms in at least ${SYMPTOMS_MIN_LENGTH} characters.`)
    .max(SYMPTOMS_MAX_LENGTH, `Please keep your description under ${SYMPTOMS_MAX_LENGTH} characters.`)
    .refine((s) => /\p{L}{2,}/u.test(s), "Please describe your symptoms in words."),
  age: z.number().int().min(0).max(120).optional(),
  sex: z.enum(["female", "male", "other"]).optional(),
});
export type SymptomInput = z.infer<typeof SymptomInputSchema>;

export const URGENCY_LEVELS = ["self_care", "see_doctor", "urgent_care", "emergency"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

/**
 * Structured output the LLM must return. Passed to the API as a JSON schema
 * (structured outputs), so the model cannot return free-form text.
 */
export const AnalysisSchema = z.object({
  recognizedAsSymptoms: z
    .boolean()
    .describe("false if the input does not describe health symptoms (e.g. gibberish or an unrelated question)"),
  summary: z.string().describe("One or two plain-language sentences summarising the picture"),
  urgency: z.enum(URGENCY_LEVELS),
  conditions: z
    .array(
      z.object({
        name: z.string(),
        likelihood: z.enum(["high", "moderate", "low"]),
        explanation: z.string().describe("Why this fits, in plain language"),
        matchingSymptoms: z.array(z.string()),
        nextSteps: z.string(),
      }),
    )
    .describe("2-5 potential conditions, most likely first; empty if recognizedAsSymptoms is false"),
  selfCareTips: z.array(z.string()),
  seekCareIf: z.array(z.string()).describe("Warning signs that should prompt the patient to seek care"),
  followUpQuestions: z.array(z.string()).describe("Questions a clinician would ask next"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export type DiagnosisRecord = {
  id: string;
  createdAt: string;
  input: SymptomInput;
  analysis: Analysis;
  redFlags: string[];
  meta: { cached: boolean; latencyMs: number; model: string };
};
