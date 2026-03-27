import type { DistanceMatrixResponse } from "../types";
import { fetchJsonWithTimeout } from "./request";
import { distanceMatrixResponseSchema, parseWithSchema } from "../utils/validation";

export interface LocationInput {
    id: string;
    lat: number;
    lng: number;
}

/**
 * Get driving distances between sequential locations.
 * The first location should be the starting point (home base).
 * Returns distances from each location to the next in sequence.
 */
export async function getDistanceMatrix(
    locations: LocationInput[]
): Promise<DistanceMatrixResponse> {
    if (locations.length < 2) {
        return { distances: [] };
    }

    // Validate coordinates before sending to API
    for (const loc of locations) {
        if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) {
            throw new Error(`Invalid coordinates for location "${loc.id}": lat=${loc.lat}, lng=${loc.lng}`);
        }
    }

    const payload = await fetchJsonWithTimeout<unknown>(
        "/api/distance-matrix",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locations })
        },
        "Distance calculation failed"
    );

    return parseWithSchema(distanceMatrixResponseSchema, payload, "getDistanceMatrix");
}
