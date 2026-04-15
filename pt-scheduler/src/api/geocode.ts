import type { GeocodeResponse } from "../types";
import { fetchJsonWithTimeout } from "./request";
import { geocodeResponseSchema, parseWithSchema } from "../utils/validation";
import { geocodeCacheDB, normalizeAddressKey } from "../db/operations";

/**
 * Geocode an address to get lat/lng coordinates.
 *
 * Read-through cache: cache hit returns immediately with zero API calls.
 * Write-through cache: successful API responses are stored for future hits.
 * Cache failures log a warning and continue — they never mask API data.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResponse> {
    const addressKey = normalizeAddressKey(address);

    // Read-through: cache hit returns immediately, zero API call.
    try {
        const hit = await geocodeCacheDB.get(addressKey);
        if (hit) {
            return { lat: hit.lat, lng: hit.lng, formattedAddress: hit.formattedAddress };
        }
    } catch (err) {
        // Private mode / quota eviction / schema upgrade race — fall through to API.
        console.warn("[Geocode] Cache read failed:", err instanceof Error ? err.message : err);
    }

    const payload = await fetchJsonWithTimeout<unknown>(
        "/api/geocode",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
        },
        "Geocoding failed",
    );
    const parsed = parseWithSchema(geocodeResponseSchema, payload, "geocodeAddress");

    // Write-through: never let a cache failure mask a successful API response.
    try {
        await geocodeCacheDB.put({
            addressKey,
            lat: parsed.lat,
            lng: parsed.lng,
            formattedAddress: parsed.formattedAddress,
            createdAt: new Date(),
        });
    } catch (err) {
        console.warn("[Geocode] Cache write failed:", err instanceof Error ? err.message : err);
    }

    return parsed;
}
