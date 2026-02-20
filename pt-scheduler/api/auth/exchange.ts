/**
 * Token exchange endpoint: Swap authorization code for access + refresh tokens.
 *
 * POST /api/auth/exchange
 * Body: { code: string }
 * Response: { access_token: string, expires_in: number }
 *
 * Sets refresh_token as an httpOnly cookie for persistent sessions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_cors.js";
import { requireEnv } from "../_env.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;

    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
        return;
    }

    const { code } = (req.body as Record<string, unknown>) ?? {};
    if (typeof code !== "string" || !code) {
        res.status(400).json({ error: "Missing authorization code", code: "BAD_REQUEST" });
        return;
    }

    try {
        const clientId = requireEnv("VITE_GOOGLE_CLIENT_ID");
        const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: "postmessage",
            grant_type: "authorization_code",
        });

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Google token exchange failed:", JSON.stringify(data));
            res.status(401).json({
                error: data.error_description || "Token exchange failed",
                google_error: data.error,
                code: "TOKEN_EXCHANGE_FAILED",
            });
            return;
        }

        const { access_token, refresh_token, expires_in } = data;

        if (!access_token) {
            res.status(502).json({ error: "No access token in response", code: "UPSTREAM_ERROR" });
            return;
        }

        // Store refresh token as httpOnly cookie (only present on first authorization)
        if (refresh_token) {
            const isSecure = req.headers["x-forwarded-proto"] === "https";
            const cookie = [
                `refresh_token=${refresh_token}`,
                "HttpOnly",
                "Path=/api/auth",
                `Max-Age=${365 * 24 * 60 * 60}`,
                "SameSite=Lax",
                ...(isSecure ? ["Secure"] : []),
            ].join("; ");
            res.setHeader("Set-Cookie", cookie);
        }

        res.status(200).json({ access_token, expires_in, persistent: !!refresh_token });
    } catch (err) {
        console.error("Exchange handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR",
        });
    }
}
