/**
 * OCR endpoint: Extract appointments from schedule screenshots.
 *
 * POST /api/ocr
 * Body: { image: string } - base64 encoded image data URL
 * Response: { appointments: ExtractedAppointment[] }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors";
import { requireEnv } from "./_env";
import { buildOCRPrompt } from "./_prompts";
import {
  ocrRequestSchema,
  ocrResponseSchema,
  validateBody,
  validateResponse
} from "./_validation";

const OPENAI_TIMEOUT_MS = 55_000; // Just under Vercel's 60s limit

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS preflight
  if (cors(req, res)) return;

  // Validate method
  if (requirePost(req, res)) return;

  // Validate request body
  const body = validateBody(req.body, ocrRequestSchema, res);
  if (!body) return;

  try {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const prompt = buildOCRPrompt();

    // Call OpenAI with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: prompt.system },
            {
              role: "user",
              content: [
                { type: "text", text: prompt.userPrefix },
                {
                  type: "image_url",
                  image_url: { url: body.image, detail: "high" }
                }
              ]
            }
          ],
          max_tokens: 2048,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenAI API error:", response.status, errorText);
        res.status(502).json({
          error: "OCR service unavailable",
          code: "UPSTREAM_ERROR"
        });
        return;
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        res.status(502).json({
          error: "OCR returned empty response",
          code: "EMPTY_RESPONSE"
        });
        return;
      }

      // Parse JSON from response (handle potential markdown wrapping)
      let parsed: unknown;
      try {
        // Try direct parse first
        parsed = JSON.parse(content);
      } catch {
        // Try extracting from markdown code block
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        } else {
          throw new Error("Could not parse response as JSON");
        }
      }

      // Validate response shape
      const validated = validateResponse(parsed, ocrResponseSchema, "OCR");

      res.status(200).json(validated);
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === "AbortError") {
        res.status(504).json({
          error: "OCR request timed out",
          code: "TIMEOUT"
        });
        return;
      }

      throw err;
    }
  } catch (err) {
    console.error("OCR handler error:", err);

    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR"
    });
  }
}
