/**
 * Extract patient endpoint: Extract structured patient info from referral text.
 *
 * POST /api/extract-patient
 * Body: { referralText: string }
 * Response: ExtractPatientResponse
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors.js";
import { requireEnv } from "./_env.js";
import { buildExtractPatientPrompt } from "./_prompts.js";
import {
    extractPatientRequestSchema,
    extractPatientResponseSchema,
    validateBody,
    validateResponse
} from "./_validation.js";

const OPENAI_TIMEOUT_MS = 30_000;

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;
    if (requirePost(req, res)) return;

    const body = validateBody(req.body, extractPatientRequestSchema, res);
    if (!body) return;

    try {
        const apiKey = requireEnv("OPENAI_API_KEY");
        const prompt = buildExtractPatientPrompt(body.referralText);

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
                        { role: "user", content: prompt.user }
                    ],
                    max_tokens: 1024,
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                console.error("OpenAI API error:", response.status, errorText);
                res.status(502).json({
                    error: "Patient extraction service unavailable",
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            const result = await response.json();
            const content = result.choices?.[0]?.message?.content;
            const finishReason = result.choices?.[0]?.finish_reason;

            if (!content) {
                res.status(502).json({
                    error: "Extraction returned empty response",
                    code: "EMPTY_RESPONSE"
                });
                return;
            }

            if (finishReason === "length") {
                console.error("Extract-patient response truncated at max_tokens. Content head:", content.slice(0, 500));
                res.status(502).json({
                    error: "Referral text too long — try pasting a shorter excerpt.",
                    code: "RESPONSE_TRUNCATED"
                });
                return;
            }

            // Parse JSON response (JSON mode normally guarantees parseable output)
            let parsed: unknown;
            try {
                parsed = JSON.parse(content);
            } catch {
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[1].trim());
                } else {
                    const first = content.indexOf("{");
                    const last = content.lastIndexOf("}");
                    if (first !== -1 && last > first) {
                        try {
                            parsed = JSON.parse(content.slice(first, last + 1));
                        } catch {
                            console.error("Extract-patient parse failure, content was:", content.slice(0, 2000));
                            throw new Error("Could not parse response as JSON");
                        }
                    } else {
                        console.error("Extract-patient parse failure, content was:", content.slice(0, 2000));
                        throw new Error("Could not parse response as JSON");
                    }
                }
            }

            const validated = validateResponse(parsed, extractPatientResponseSchema, "ExtractPatient");
            res.status(200).json(validated);

        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof Error && err.name === "AbortError") {
                res.status(504).json({ error: "Patient extraction timed out", code: "TIMEOUT" });
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error("Extract patient handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR"
        });
    }
}
