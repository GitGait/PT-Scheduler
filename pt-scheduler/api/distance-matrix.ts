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

        // Build sequential leg pairs: home->1, 1->2, 2->3, etc.
        // Each leg becomes a 1x1 Distance Matrix request so Google bills
        // us per leg (N-1 elements) instead of per full matrix (N^2 elements).
        type Location = typeof locations[number];
        const legs: Array<{ from: Location; to: Location }> = [];
        for (let i = 0; i < locations.length - 1; i++) {
            legs.push({ from: locations[i], to: locations[i + 1] });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);

        type LegElement = {
            status: string;
            distance?: { value: number };
            duration?: { value: number };
        };
        type LegResult = { from: Location; to: Location; element: LegElement };

        const fetchLeg = async ({ from, to }: { from: Location; to: Location }): Promise<LegResult> => {
            const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
            url.searchParams.set("origins", `${from.lat},${from.lng}`);
            url.searchParams.set("destinations", `${to.lat},${to.lng}`);
            url.searchParams.set("mode", "driving");
            url.searchParams.set("units", "imperial");
            url.searchParams.set("key", apiKey);

            const response = await fetch(url.toString(), { signal: controller.signal });
            if (!response.ok) throw new Error(`upstream ${response.status}`);
            const data = await response.json();
            if (data.status !== "OK") {
                throw new Error(`maps ${data.status}: ${data.error_message ?? ""}`);
            }
            const element = data.rows?.[0]?.elements?.[0] as LegElement | undefined;
            if (!element) throw new Error("maps: missing element");
            if (element.status !== "OK") throw new Error(`element ${element.status}`);
            return { from, to, element };
        };

        try {
            // Cap concurrency at 20 parallel fetches to avoid hammering upstream.
            // Realistic day (<20 stops) fits in a single chunk.
            const CONCURRENCY = 20;
            const settled: PromiseSettledResult<LegResult>[] = [];
            for (let i = 0; i < legs.length; i += CONCURRENCY) {
                const chunk = legs.slice(i, i + CONCURRENCY);
                const chunkResults = await Promise.allSettled(chunk.map(fetchLeg));
                settled.push(...chunkResults);
            }
            clearTimeout(timeout);

            const distances: Array<{
                originId: string;
                destinationId: string;
                distanceMiles: number;
                durationMinutes: number;
            }> = [];

            for (let i = 0; i < settled.length; i++) {
                const result = settled[i];
                const leg = legs[i];
                if (result.status === "fulfilled") {
                    const { from, to, element } = result.value;
                    const distanceMeters = element.distance?.value ?? 0;
                    const durationSeconds = element.duration?.value ?? 0;
                    distances.push({
                        originId: from.id,
                        destinationId: to.id,
                        distanceMiles: Math.round(distanceMeters / 1609.34 * 10) / 10,
                        durationMinutes: Math.round(durationSeconds / 60)
                    });
                } else {
                    const reason = result.reason instanceof Error
                        ? result.reason.message
                        : String(result.reason);
                    console.warn(
                        `[DistanceMatrix] leg ${leg.from.id} -> ${leg.to.id} failed: ${reason}`
                    );
                }
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
