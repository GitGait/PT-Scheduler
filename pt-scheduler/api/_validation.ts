/**
 * Server-side validation helpers for API endpoints.
 *
 * Re-exports schemas from src/utils/validation.ts and adds
 * helpers for returning consistent error responses.
 */

import type { VercelResponse } from "@vercel/node";
import { z } from "zod";

// Re-export schemas for serverless use
export {
  ocrRequestSchema,
  ocrResponseSchema,
  optimizeRequestSchema,
  optimizeResponseSchema,
  geocodeRequestSchema,
  geocodeResponseSchema,
  matchPatientRequestSchema,
  aiMatchResponseSchema,
  extractPatientRequestSchema,
  extractPatientResponseSchema,
  csvMappingRequestSchema,
  csvMappingResponseSchema
} from "../src/utils/validation.js";
/**
 * Validate request body against a Zod schema.
 * Returns the validated data or sends a 400 error and returns null.
 */
export function validateBody<T>(
  body: unknown,
  schema: z.ZodType<T>,
  res: VercelResponse
): T | null {
  const result = schema.safeParse(body);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "field"}: ${issue.message}`)
      .join("; ");

    res.status(400).json({
      error: "Invalid request",
      code: "VALIDATION_ERROR",
      details
    });

    return null;
  }

  return result.data;
}

/**
 * Validate an upstream API response and return parsed data.
 * Throws an error if validation fails (to be caught by error handler).
 */
export function validateResponse<T>(
  data: unknown,
  schema: z.ZodType<T>,
  context: string
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}:${issue.message}`)
      .join("; ");
    throw new Error(`${context} response validation failed: ${details}`);
  }

  return result.data;
}
