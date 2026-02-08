/**
 * Route optimization endpoint: Optimize driving route for appointments.
 *
 * POST /api/optimize
 * Body: { locations: Location[], startLocation: StartLocation }
 * Response: OptimizeResponse
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, requirePost } from "./_cors";
import { requireEnv } from "./_env";
import {
    optimizeRequestSchema,
    optimizeResponseSchema,
    validateBody,
    validateResponse
} from "./_validation";

const GOOGLE_TIMEOUT_MS = 30_000;

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    if (cors(req, res)) return;
    if (requirePost(req, res)) return;

    const body = validateBody(req.body, optimizeRequestSchema, res);
    if (!body) return;

    try {
        const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");

        // Build waypoints for Google Directions API
        const { locations, startLocation } = body;

        if (locations.length === 0) {
            res.status(200).json({
                optimizedOrder: [],
                totalDriveMinutes: 0,
                totalMiles: 0
            });
            return;
        }

        // For single location, no optimization needed
        if (locations.length === 1) {
            res.status(200).json({
                optimizedOrder: [{
                    locationId: locations[0].id,
                    order: 1,
                    driveTimeMinutes: 0,
                    distanceMiles: 0
                }],
                totalDriveMinutes: 0,
                totalMiles: 0
            });
            return;
        }

        // Build origin, destination, and waypoints
        const origin = `${startLocation.lat},${startLocation.lng}`;
        const destination = origin; // Return to start
        const waypoints = locations.map(l => `${l.lat},${l.lng}`).join("|");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);

        try {
            const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
            url.searchParams.set("origin", origin);
            url.searchParams.set("destination", destination);
            url.searchParams.set("waypoints", `optimize:true|${waypoints}`);
            url.searchParams.set("key", apiKey);

            const response = await fetch(url.toString(), { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                res.status(502).json({
                    error: "Route optimization service unavailable",
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            const data = await response.json();

            if (data.status !== "OK") {
                res.status(502).json({
                    error: `Google Maps error: ${data.status}`,
                    code: "UPSTREAM_ERROR"
                });
                return;
            }

            // Parse the optimized route
            const route = data.routes?.[0];
            if (!route) {
                res.status(502).json({
                    error: "No route found",
                    code: "NO_ROUTE"
                });
                return;
            }

            const waypointOrder = route.waypoint_order as number[];
            const legs = route.legs as Array<{ duration: { value: number }; distance: { value: number } }>;

            let totalDriveSeconds = 0;
            let totalDistanceMeters = 0;

            const optimizedOrder = waypointOrder.map((originalIndex, optimizedIndex) => {
                const leg = legs[optimizedIndex];
                totalDriveSeconds += leg?.duration?.value ?? 0;
                totalDistanceMeters += leg?.distance?.value ?? 0;

                return {
                    locationId: locations[originalIndex].id,
                    order: optimizedIndex + 1,
                    driveTimeMinutes: Math.round((leg?.duration?.value ?? 0) / 60),
                    distanceMiles: Math.round((leg?.distance?.value ?? 0) / 1609.34 * 10) / 10
                };
            });

            const result = {
                optimizedOrder,
                totalDriveMinutes: Math.round(totalDriveSeconds / 60),
                totalMiles: Math.round(totalDistanceMeters / 1609.34 * 10) / 10
            };

            const validated = validateResponse(result, optimizeResponseSchema, "Optimize");
            res.status(200).json(validated);

        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof Error && err.name === "AbortError") {
                res.status(504).json({ error: "Route optimization timed out", code: "TIMEOUT" });
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error("Optimize handler error:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
            code: "INTERNAL_ERROR"
        });
    }
}
