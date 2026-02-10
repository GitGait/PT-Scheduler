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
