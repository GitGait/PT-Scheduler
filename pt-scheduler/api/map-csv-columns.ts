/**
 * CSV mapping endpoint: map arbitrary CSV headers to patient schema fields.
 *
 * POST /api/map-csv-columns
 * Body: { headers: string[], sampleRows: string[][] }
 * Response: { mapping: {...}, confidence?: Record<string, number> }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors.js";
import { optionalEnv, requireEnv } from "./_env.js";
import { buildCsvMappingPrompt } from "./_prompts.js";
import {
  csvMappingRequestSchema,
  csvMappingResponseSchema,
  validateBody,
  validateResponse,
} from "./_validation.js";

const OPENAI_TIMEOUT_MS = 30_000;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (cors(req, res)) return;
  if (requirePost(req, res)) return;

  const body = validateBody(req.body, csvMappingRequestSchema, res);
  if (!body) return;

  try {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const configuredModel = optionalEnv("CSV_MAPPING_MODEL", "gpt-4o-mini");
    const candidateModels = [...new Set([configuredModel, "gpt-4o-mini"])];
    const prompt = buildCsvMappingPrompt(body.headers, body.sampleRows);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
      let result: unknown = null;
      let lastErrorText = "";
      let lastStatus = 502;
      let content: string | undefined;

      for (const model of candidateModels) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0,
            max_tokens: 1200,
          }),
          signal: controller.signal,
        });

        if (response.ok) {
          result = await response.json();
          content = (result as { choices?: Array<{ message?: { content?: string } }> })
            .choices?.[0]?.message?.content;
          break;
        }

        lastStatus = response.status;
        lastErrorText = await response.text();
        console.warn(`CSV mapping model ${model} failed (${response.status})`);
      }

      clearTimeout(timeout);

      if (!content) {
        console.error("CSV mapping OpenAI API error:", lastStatus, lastErrorText);
        res.status(502).json({
          error: "CSV mapping service unavailable",
          code: "UPSTREAM_ERROR",
        });
        return;
      }

      if (!result) {
          res.status(502).json({
            error: "CSV mapping returned empty response",
            code: "EMPTY_RESPONSE",
          });
          return;
        }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        } else {
          throw new Error("Could not parse CSV mapping response as JSON");
        }
      }

      const validated = validateResponse(parsed, csvMappingResponseSchema, "CSVMapping");
      res.status(200).json(validated);
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === "AbortError") {
        res.status(504).json({
          error: "CSV mapping request timed out",
          code: "TIMEOUT",
        });
        return;
      }

      throw err;
    }
  } catch (err) {
    console.error("CSV mapping handler error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}
