import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildMatchPrompt } from "./_prompts";
import { requireEnv } from "./_env";
import { cors, requirePost } from "./_cors";

interface MatchRequest {
    ocrName: string;
    candidateNames: string[];
}

interface MatchResponse {
    matchedName: string | null;
    confidence: number;
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    // Handle CORS preflight
    if (cors(req, res)) return;
    if (requirePost(req, res)) return;

    try {
        const { ocrName, candidateNames } = req.body as MatchRequest;

        if (!ocrName || !candidateNames || !Array.isArray(candidateNames)) {
            res.status(400).json({ error: "Missing ocrName or candidateNames" });
            return;
        }

        if (candidateNames.length === 0) {
            res.status(200).json({ matchedName: null, confidence: 0 } as MatchResponse);
            return;
        }

        const apiKey = requireEnv("OPENAI_API_KEY");
        const { system, user } = buildMatchPrompt(ocrName, candidateNames);

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: 0,
                max_tokens: 150,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI API error:", errorText);
            res.status(502).json({ error: "AI service unavailable" });
            return;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            res.status(502).json({ error: "Empty response from AI" });
            return;
        }

        // Parse JSON response
        const parsed: MatchResponse = JSON.parse(content);

        res.status(200).json(parsed);
    } catch (error) {
        console.error("Match patient error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
