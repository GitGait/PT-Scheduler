/**
 * Token refresh endpoint: Use stored refresh token to get a new access token.
 *
 * POST   /api/auth/refresh  -> Returns { access_token, expires_in }
 * DELETE /api/auth/refresh  -> Clears refresh token cookie (sign-out)
 *
 * Reads/clears the httpOnly refresh_token cookie set by /api/auth/exchange.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_cors.js";
import { requireEnv } from "../_env.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};
    return Object.fromEntries(
        header.split(";").map((c) => {
            const [k, ...v] = c.trim().split("=");
            return [k, v.join("=")];
        })
    );
}

function clearCookie(req: VercelRequest, res: VercelResponse): void {
    const isSecure = req.headers["x-forwarded-proto"] === "https";
    const cookie = [
        "refresh_token=",
        "HttpOnly",
        "Path=/api/auth",
        "Max-Age=0",
        "SameSite=Lax",
        ...(isSecure ? ["Secure"] : []),
    ].join("; ");
    res.setHeader("Set-Cookie", cookie);
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;

    // DELETE = sign out (clear cookie)
    if (req.method === "DELETE") {
        clearCookie(req, res);
        res.status(204).end();
        return;
    }

    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
        return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies.refresh_token;

    if (!refreshToken) {
        res.status(401).json({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
        return;
    }

    try {
        const clientId = requireEnv("VITE_GOOGLE_CLIENT_ID");
        const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        });

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!response.ok) {
            // Refresh token revoked or expired — clear cookie
            clearCookie(req, res);
            res.status(401).json({
                error: "Refresh token expired or revoked",
                code: "REFRESH_TOKEN_INVALID",
            });
            return;
        }

        const data = await response.json();
        res.status(200).json({
            access_token: data.access_token,
            expires_in: data.expires_in,
        });
    } catch (err) {
        console.error("Refresh handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR",
        });
    }
}
