import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeAddress } from "./geocode";
import * as request from "./request";
import * as operations from "../db/operations";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("./request", () => ({
    fetchJsonWithTimeout: vi.fn(),
}));

const mockFetch = vi.mocked(request.fetchJsonWithTimeout);

// Spy on geocodeCacheDB through the operations module so individual tests can
// override behaviour without affecting the real IndexedDB (which fake-indexeddb
// stubs globally via setup.ts).
const geocodeCacheGetSpy = vi.spyOn(operations.geocodeCacheDB, "get");
const geocodeCachePutSpy = vi.spyOn(operations.geocodeCacheDB, "put");

// Default API response that passes geocodeResponseSchema validation.
const API_RESPONSE = { lat: 39.7994, lng: -89.6442, formattedAddress: "123 Main St, Springfield, IL 62701, USA" };

beforeEach(() => {
    vi.clearAllMocks();
    // Default: cache miss, then successful API + write.
    geocodeCacheGetSpy.mockResolvedValue(undefined);
    geocodeCachePutSpy.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(API_RESPONSE);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("geocodeAddress — read-through cache", () => {
    it("calls fetchJsonWithTimeout exactly once and caches the result; second call is served from cache", async () => {
        const address = "123 Main St";

        // First call — cache miss, goes to API.
        const first = await geocodeAddress(address);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(first).toEqual(API_RESPONSE);
        expect(geocodeCachePutSpy).toHaveBeenCalledTimes(1);

        // Simulate the second call finding the cached entry.
        const cachedEntry = {
            addressKey: "123 main st",
            lat: API_RESPONSE.lat,
            lng: API_RESPONSE.lng,
            formattedAddress: API_RESPONSE.formattedAddress,
            createdAt: new Date(),
        };
        geocodeCacheGetSpy.mockResolvedValue(cachedEntry);

        const second = await geocodeAddress(address);
        // Still exactly one fetch — second was served from cache.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(second).toEqual({ lat: API_RESPONSE.lat, lng: API_RESPONSE.lng, formattedAddress: API_RESPONSE.formattedAddress });
    });

    it("differently-cased / extra-spaced input normalises to the same key and incurs zero additional fetches after first call", async () => {
        // Prime the cache so the get spy returns a hit for the normalised key.
        const cachedEntry = {
            addressKey: "123 main st",
            lat: API_RESPONSE.lat,
            lng: API_RESPONSE.lng,
            formattedAddress: API_RESPONSE.formattedAddress,
            createdAt: new Date(),
        };
        geocodeCacheGetSpy.mockResolvedValue(cachedEntry);

        const result = await geocodeAddress("  123 MAIN st  ");

        expect(mockFetch).not.toHaveBeenCalled();
        expect(geocodeCacheGetSpy).toHaveBeenCalledWith("123 main st");
        expect(result.lat).toBe(API_RESPONSE.lat);
        expect(result.lng).toBe(API_RESPONSE.lng);
    });

    it("cache write failure does not throw from geocodeAddress — API result is still returned", async () => {
        geocodeCachePutSpy.mockRejectedValue(new Error("QuotaExceededError"));

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await geocodeAddress("456 Oak Ave");

        // Must resolve successfully despite the put failure.
        expect(result).toEqual(API_RESPONSE);
        // Warning should have been logged.
        expect(warnSpy).toHaveBeenCalledWith(
            "[Geocode] Cache write failed:",
            "QuotaExceededError",
        );
        warnSpy.mockRestore();
    });

    it("cache read failure falls through to fetchJsonWithTimeout and returns API result", async () => {
        geocodeCacheGetSpy.mockRejectedValue(new Error("IDBKeyRange error"));

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await geocodeAddress("789 Elm St");

        // Must still call the API and return its data.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(result).toEqual(API_RESPONSE);
        expect(warnSpy).toHaveBeenCalledWith(
            "[Geocode] Cache read failed:",
            "IDBKeyRange error",
        );
        warnSpy.mockRestore();
    });
});
