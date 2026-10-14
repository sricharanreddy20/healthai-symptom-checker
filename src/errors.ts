/**
 * Application errors carry an HTTP status, a stable machine-readable code, and a
 * message that is safe to show to patients. Anything that is not an AppError is
 * treated as an unexpected 500 and its details are logged, never returned.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(404, "NOT_FOUND", message);
  }
}

/** The input passed validation but the model judged it is not a description of symptoms. */
export class UnrecognizedSymptomsError extends AppError {
  constructor() {
    super(422, "UNRECOGNIZED_SYMPTOMS", "We couldn't identify any symptoms in that description. Please describe how you feel, e.g. \"sore throat and fever for two days\".");
  }
}

/** The LLM provider failed in a way the patient can retry (rate limit, overload, network, timeout). */
export class LlmUnavailableError extends AppError {
  constructor(message = "The analysis service is busy right now. Please try again in a moment.", status = 503) {
    super(status, "LLM_UNAVAILABLE", message);
  }
}

/** The LLM provider failed in a way retrying won't fix (bad config, malformed output, refusal). */
export class LlmFailedError extends AppError {
  constructor(message = "We couldn't analyse your symptoms. Please try rephrasing your description.") {
    super(502, "LLM_FAILED", message);
  }
}
