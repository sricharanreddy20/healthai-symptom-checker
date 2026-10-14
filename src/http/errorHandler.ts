import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../errors.ts";

/** Every error response has the same shape: { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) console.warn(`[http] ${req.method} ${req.path} -> ${err.status} ${err.code}`);
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.issues[0]?.message ?? "Invalid request." } });
    return;
  }
  // Errors raised by express.json() (malformed JSON, body too large) carry a status.
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    const message = err.type === "entity.too.large" ? "Request is too large." : "Request body must be valid JSON.";
    res.status(err.status).json({ error: { code: "BAD_REQUEST", message } });
    return;
  }
  console.error(`[http] unhandled error on ${req.method} ${req.path}`, err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." } });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
};
