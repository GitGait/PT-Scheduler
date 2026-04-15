/**
 * Tests for the Distance Matrix handler.
 *
 * The billing fix (per-leg 1x1 fetches instead of a full NxN matrix) is
 * visible only by inspecting how many times `fetch` is called and what
 * URLs it receives. These tests are the external proof that the billing
 * fix landed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./distance-matrix";

type MockResponse = {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    _status: number;
    _body: unknown;
};

function makeRes(): MockResponse {
    const res: MockResponse = {
        _status: 0,
        _body: undefined,
        status: vi.fn(),
        json: vi.fn(),
        setHeader: vi.fn(),
        end: vi.fn()
    };
    res.status.mockImplementation((code: number) => {
        res._status = code;
        return res;
    });
    res.json.mockImplementation((body: unknown) => {
        res._body = body;
        return res;
    });
    res.setHeader.mockImplementation(() => res);
    res.end.mockImplementation(() => res);
    return res;
}

function makeReq(body: unknown): VercelRequest {
    return {
        method: "POST",
        body,
        headers: { origin: "http://localhost:5173" },
        query: {},
        cookies: {}
    } as unknown as VercelRequest;
}

function makeLocations(count: number): Array<{ id: string; lat: number; lng: number }> {
    const out: Array<{ id: string; lat: number; lng: number }> = [];
    for (let i = 0; i < count; i++) {
        out.push({
            id: `loc-${i}`,
            lat: 40 + i * 0.01,
            lng: -74 - i * 0.01
        });
    }
    return out;
}

function googleOkResponse(distanceMeters = 1609, durationSeconds = 300): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            status: "OK",
            rows: [
                {
                    elements: [
                        {
                            status: "OK",
                            distance: { value: distanceMeters },
                            duration: { value: durationSeconds }
                        }
                    ]
                }
            ]
        })
    } as unknown as Response;
}

describe("distance-matrix handler", () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;

    beforeEach(() => {
        process.env.GOOGLE_MAPS_API_KEY = "test-key";
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) {
            delete process.env.GOOGLE_MAPS_API_KEY;
        } else {
            process.env.GOOGLE_MAPS_API_KEY = originalKey;
        }
        vi.restoreAllMocks();
    });

    it("sends one fetch per sequential leg, not one batched call", async () => {
        const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
        fetchMock.mockImplementation(async () => googleOkResponse(1609, 300));

        const locations = makeLocations(11); // 11 locations => 10 legs
        const req = makeReq({ locations });
        const res = makeRes();

        await handler(req, res as unknown as VercelResponse);

        // CRITICAL: exactly 10 calls — one per leg, not one batched call.
        expect(fetchMock).toHaveBeenCalledTimes(10);

        // Every call must have a single coordinate pair in origins and destinations.
        for (const call of fetchMock.mock.calls) {
            const urlString = call[0] as string;
            const url = new URL(urlString);
            const origins = url.searchParams.get("origins") ?? "";
            const destinations = url.searchParams.get("destinations") ?? "";
            expect(origins.includes("|")).toBe(false);
            expect(destinations.includes("|")).toBe(false);
            expect(origins.split(",").length).toBe(2); // "lat,lng"
            expect(destinations.split(",").length).toBe(2);
        }

        // Response shape is preserved.
        expect(res._status).toBe(200);
        const body = res._body as {
            distances: Array<{
                originId: string;
                destinationId: string;
                distanceMiles: number;
                durationMinutes: number;
            }>;
        };
        expect(body.distances).toHaveLength(10);
        for (const entry of body.distances) {
            expect(typeof entry.originId).toBe("string");
            expect(typeof entry.destinationId).toBe("string");
            expect(typeof entry.distanceMiles).toBe("number");
            expect(typeof entry.durationMinutes).toBe("number");
        }
    });

    it("partial failure: one rejected fetch still returns successful legs", async () => {
        const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
        let callIndex = -1;
        fetchMock.mockImplementation(async () => {
            callIndex += 1;
            if (callIndex === 3) {
                return {
                    ok: false,
                    status: 500,
                    json: async () => ({})
                } as unknown as Response;
            }
            return googleOkResponse(1609, 300);
        });

        const locations = makeLocations(11);
        const req = makeReq({ locations });
        const res = makeRes();

        await handler(req, res as unknown as VercelResponse);

        // Partial success: 200, not 502.
        expect(res._status).toBe(200);
        const body = res._body as {
            distances: Array<{
                originId: string;
                destinationId: string;
                distanceMiles: number;
                durationMinutes: number;
            }>;
        };
        expect(body.distances).toHaveLength(9);
    });
});
