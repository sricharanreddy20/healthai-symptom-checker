/**
 * Deterministic emergency screen that runs before (and independently of) the LLM.
 * A model can be slow, unavailable, or wrong; these phrases always surface an
 * "call emergency services" banner. Deliberately conservative: false positives
 * are acceptable, false negatives are not.
 */
const RED_FLAGS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Chest pain or pressure", pattern: /\bchest\s+(pain|pressure|tightness|tight)\b|\btight(ness)?\s+(in\s+)?(my\s+)?chest\b/i },
  { label: "Difficulty breathing", pattern: /\b(can'?t|cannot|unable to|hard to|difficulty|trouble)\s+breath(e|ing)\b|\bshort(ness)? of breath\b|\bgasping\b/i },
  { label: "Signs of stroke", pattern: /\b(face|facial)\s+droop|\bslurred\s+speech\b|\b(sudden\s+)?(numbness|weakness)\s+(on|in)\s+one\s+side\b/i },
  { label: "Severe bleeding", pattern: /\b(heavy|severe|uncontrolled|won'?t stop)\s+bleeding\b|\bbleeding\s+(heavily|won'?t stop)\b|\bvomiting\s+blood\b|\bcoughing\s+(up\s+)?blood\b/i },
  { label: "Loss of consciousness", pattern: /\b(passed out|fainted|unconscious|loss of consciousness|blacked out)\b/i },
  { label: "Seizure", pattern: /\bseizure|convulsion/i },
  { label: "Thoughts of self-harm", pattern: /\b(suicid\w*|kill myself|end my life|self[- ]harm|hurt myself)\b/i },
  { label: "Severe allergic reaction", pattern: /\b(anaphyla\w*|throat (is )?(closing|swelling)|swollen (tongue|throat))\b/i },
  { label: "Worst headache of life", pattern: /\bworst headache\b|\bthunderclap\b/i },
];

export function detectRedFlags(text: string): string[] {
  return RED_FLAGS.filter((f) => f.pattern.test(text)).map((f) => f.label);
}
