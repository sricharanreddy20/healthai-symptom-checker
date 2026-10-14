import type { Analysis, SymptomInput, Urgency } from "../domain/schemas.ts";
import type { DiagnosisProvider } from "./provider.ts";

type Rule = {
  keywords: RegExp;
  condition: Analysis["conditions"][number];
  urgency: Urgency;
};

const RULES: Rule[] = [
  {
    keywords: /\b(fever|chills|body ?aches?|fatigue)\b/i,
    urgency: "see_doctor",
    condition: { name: "Influenza (flu)", likelihood: "moderate", explanation: "Fever with aches and tiredness is a classic flu pattern.", matchingSymptoms: ["fever", "body aches", "fatigue"], nextSteps: "Rest, fluids, and a doctor visit if you are in a high-risk group." },
  },
  {
    keywords: /\b(sore throat|runny nose|cough|sneez\w*|congest\w*)\b/i,
    urgency: "self_care",
    condition: { name: "Common cold", likelihood: "high", explanation: "Throat and nose symptoms without severe illness usually point to a viral cold.", matchingSymptoms: ["sore throat", "runny nose", "cough"], nextSteps: "Rest and fluids; symptoms usually clear within 7-10 days." },
  },
  {
    keywords: /\b(headache|migraine|light sensitivity)\b/i,
    urgency: "self_care",
    condition: { name: "Tension headache", likelihood: "moderate", explanation: "Most headaches are tension-type, linked to stress, posture or poor sleep.", matchingSymptoms: ["headache"], nextSteps: "Rest, hydration and over-the-counter pain relief as directed." },
  },
  {
    keywords: /\b(nausea|vomit\w*|diarrh\w*|stomach|abdominal)\b/i,
    urgency: "self_care",
    condition: { name: "Viral gastroenteritis", likelihood: "moderate", explanation: "Stomach upset with nausea or diarrhoea is often a short-lived stomach bug.", matchingSymptoms: ["nausea", "diarrhoea"], nextSteps: "Small sips of fluid often; see a doctor if you cannot keep fluids down." },
  },
  {
    keywords: /\b(chest pain|chest pressure|short(ness)? of breath)\b/i,
    urgency: "emergency",
    condition: { name: "Possible heart or lung problem", likelihood: "moderate", explanation: "Chest pain or breathlessness needs urgent assessment to rule out serious causes.", matchingSymptoms: ["chest pain"], nextSteps: "Call emergency services now." },
  },
];

const URGENCY_ORDER: Urgency[] = ["self_care", "see_doctor", "urgent_care", "emergency"];
const LIKELIHOOD_ORDER = ["high", "moderate", "low"];

/**
 * Keyword-based stand-in for the LLM. Lets the app run, demo and test with no API
 * key; the artificial delay makes the cache speed-up observable offline.
 */
export class MockProvider implements DiagnosisProvider {
  readonly modelId = "mock-model";
  private readonly latencyMs: number;

  constructor(latencyMs = 0) {
    this.latencyMs = latencyMs;
  }

  async analyze(input: SymptomInput): Promise<Analysis> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const matches = RULES.filter((r) => r.keywords.test(input.symptoms)).sort(
      (a, b) => LIKELIHOOD_ORDER.indexOf(a.condition.likelihood) - LIKELIHOOD_ORDER.indexOf(b.condition.likelihood),
    );
    if (matches.length === 0) {
      return {
        recognizedAsSymptoms: /\b(pain|ache|hurt|sore|itch|swell\w*|rash|tired|dizz\w*)\b/i.test(input.symptoms),
        summary: "(Demo mode) Your description didn't match the mock model's small rule set.",
        urgency: "see_doctor",
        conditions: [],
        selfCareTips: [],
        seekCareIf: ["Symptoms get worse or don't improve within a few days"],
        followUpQuestions: [],
      };
    }

    const urgency = URGENCY_ORDER[Math.max(...matches.map((m) => URGENCY_ORDER.indexOf(m.urgency)))] ?? "see_doctor";
    return {
      recognizedAsSymptoms: true,
      summary: `(Demo mode) Your symptoms are most consistent with ${matches[0]!.condition.name.toLowerCase()}.`,
      urgency,
      conditions: matches.map((m) => m.condition),
      selfCareTips: ["Rest and stay hydrated", "Track how your symptoms change over the next 48 hours"],
      seekCareIf: ["Symptoms last more than a week", "You develop a high fever or trouble breathing"],
      followUpQuestions: ["When did the symptoms start?", "Have you taken any medication for them?"],
    };
  }
}
