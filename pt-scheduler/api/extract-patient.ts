/**
 * Extract patient endpoint: Extract structured patient info from referral text.
 *
 * POST /api/extract-patient
 * Body: { referralText: string }
 * Response: ExtractPatientResponse
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors";
import { requireEnv } from "./_env";
import { buildExtractPatientPrompt } from "./_prompts";
import {
    extractPatientRequestSchema,
    extractPatientResponseSchema,
    validateBody,
    validateResponse
} from "./_validation";

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
                    temperature: 0.1
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

            if (!content) {
                res.status(502).json({
                    error: "Extraction returned empty response",
                    code: "EMPTY_RESPONSE"
                });
                return;
            }

            // Parse JSON response
            let parsed: unknown;
            try {
                parsed = JSON.parse(content);
            } catch {
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[1].trim());
                } else {
                    throw new Error("Could not parse response as JSON");
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
