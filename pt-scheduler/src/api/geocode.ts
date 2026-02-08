import type { GeocodeResponse } from "../types";
import { fetchJsonWithTimeout } from "./request";
import { geocodeResponseSchema, parseWithSchema } from "../utils/validation";

/**
 * Geocode an address to get lat/lng coordinates.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResponse> {
    const payload = await fetchJsonWithTimeout<unknown>(
        "/api/geocode",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address })
        },
        "Geocoding failed"
    );

    return parseWithSchema(geocodeResponseSchema, payload, "geocodeAddress");
}
