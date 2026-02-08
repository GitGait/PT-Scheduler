/**
 * Geocode endpoint: Convert address to lat/lng coordinates.
 *
 * POST /api/geocode
 * Body: { address: string }
 * Response: GeocodeResponse
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors";
import { requireEnv } from "./_env";
import {
    geocodeRequestSchema,
    geocodeResponseSchema,
    validateBody,
    validateResponse
} from "./_validation";

const GOOGLE_TIMEOUT_MS = 10_000;

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;
    if (requirePost(req, res)) return;

    const body = validateBody(req.body, geocodeRequestSchema, res);
    if (!body) return;

    try {
        const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);

        try {
            const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
            url.searchParams.set("address", body.address);
            url.searchParams.set("key", apiKey);

            const response = await fetch(url.toString(), { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                res.status(502).json({
                    error: "Geocoding service unavailable",
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            const data = await response.json();

            if (data.status === "ZERO_RESULTS") {
                res.status(404).json({
                    error: "Address not found",
                    code: "NOT_FOUND"
                });
                return;
            }

            if (data.status !== "OK") {
                res.status(502).json({
                    error: `Geocoding error: ${data.status}`,
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            const location = data.results?.[0]?.geometry?.location;
            const formattedAddress = data.results?.[0]?.formatted_address;

            if (!location) {
                res.status(502).json({
                    error: "Invalid geocoding response",
                    code: "INVALID_RESPONSE"
                });
                return;
            }

            const result = {
                lat: location.lat,
                lng: location.lng,
                formattedAddress
            };

            const validated = validateResponse(result, geocodeResponseSchema, "Geocode");
            res.status(200).json(validated);

        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof Error && err.name === "AbortError") {
                res.status(504).json({ error: "Geocoding timed out", code: "TIMEOUT" });
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error("Geocode handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR"
        });
    }
}
