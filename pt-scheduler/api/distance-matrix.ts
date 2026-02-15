/**
 * Distance Matrix endpoint: Get driving distances between sequential locations.
 *
 * POST /api/distance-matrix
 * Body: { locations: Array<{ id: string, lat: number, lng: number }> }
 * Response: DistanceMatrixResponse
 *
 * Calculates driving distance/duration from each location to the next in sequence.
 * The first location is treated as the starting point (home base).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors.js";
import { requireEnv } from "./_env.js";
import {
    distanceMatrixRequestSchema,
    distanceMatrixResponseSchema,
    validateBody,
    validateResponse
} from "./_validation.js";

const GOOGLE_TIMEOUT_MS = 15_000;

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;
    if (requirePost(req, res)) return;

    const body = validateBody(req.body, distanceMatrixRequestSchema, res);
    if (!body) return;

    try {
        const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
        const { locations } = body;

        // For less than 2 locations, return empty
        if (locations.length < 2) {
            res.status(200).json({ distances: [] });
            return;
        }

        // Build origins and destinations for sequential pairs
        // We want: home->1, 1->2, 2->3, etc.
        // Origins: all locations except the last
        // Destinations: all locations except the first
        const origins = locations.slice(0, -1).map(l => `${l.lat},${l.lng}`).join("|");
        const destinations = locations.slice(1).map(l => `${l.lat},${l.lng}`).join("|");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);

        try {
            const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
            url.searchParams.set("origins", origins);
            url.searchParams.set("destinations", destinations);
            url.searchParams.set("mode", "driving");
            url.searchParams.set("units", "imperial");
            url.searchParams.set("key", apiKey);

            const response = await fetch(url.toString(), { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                res.status(502).json({
                    error: "Distance Matrix service unavailable",
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            const data = await response.json();

            if (data.status !== "OK") {
                console.error("[DistanceMatrix] Google API status:", data.status, "error_message:", data.error_message);
                res.status(502).json({
                    error: `Google Maps error: ${data.status} - ${data.error_message || "unknown"}`,
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            // Parse the response - we only need the diagonal (sequential pairs)
            // Row 0 is home->dest0, Row 1 is loc1->dest1, etc.
            // But Distance Matrix returns a full matrix, so we need row i, column i
            const distances: Array<{
                originId: string;
                destinationId: string;
                distanceMiles: number;
                durationMinutes: number;
            }> = [];

            const rows = data.rows as Array<{
                elements: Array<{
                    status: string;
                    distance?: { value: number };
                    duration?: { value: number };
                }>;
            }>;

            for (let i = 0; i < rows.length; i++) {
                const element = rows[i].elements[i];

                if (element.status !== "OK") {
                    console.warn(`[DistanceMatrix] Element ${i} status: ${element.status} (${locations[i].id} -> ${locations[i + 1].id})`);
                    continue;
                }

                const distanceMeters = element.distance?.value ?? 0;
                const durationSeconds = element.duration?.value ?? 0;

                distances.push({
                    originId: locations[i].id,
                    destinationId: locations[i + 1].id,
                    distanceMiles: Math.round(distanceMeters / 1609.34 * 10) / 10,
                    durationMinutes: Math.round(durationSeconds / 60)
                });
            }

            const result = { distances };
            const validated = validateResponse(result, distanceMatrixResponseSchema, "DistanceMatrix");
            res.status(200).json(validated);

        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof Error && err.name === "AbortError") {
                res.status(504).json({ error: "Distance Matrix timed out", code: "TIMEOUT" });
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error("Distance Matrix handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR"
        });
    }
}
