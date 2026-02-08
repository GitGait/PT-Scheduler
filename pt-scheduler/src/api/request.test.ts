import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchJsonWithTimeout } from "./request";
import { ApiError } from "../utils/apiError";

describe("fetchJsonWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    const mockData = { result: "success" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const result = await fetchJsonWithTimeout<typeof mockData>(
      "/api/test",
      { method: "GET" },
      "Test failed"
    );

    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "GET",
      signal: expect.any(AbortSignal)
    }));
  });

  it("throws ApiError on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found", code: "NOT_FOUND" })
    });

    await expect(
      fetchJsonWithTimeout("/api/test", { method: "GET" }, "Fallback")
    ).rejects.toMatchObject({
      message: "Not found",
      status: 404,
      code: "NOT_FOUND"
    });
  });

  it("uses fallback message when response has no error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Invalid JSON"))
    });

    await expect(
      fetchJsonWithTimeout("/api/test", { method: "GET" }, "Service unavailable")
    ).rejects.toMatchObject({
      message: "Service unavailable",
      status: 500
    });
  });

  it("throws timeout error when request times out", async () => {
    // Create an abort error
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    // Mock fetch to reject with abort error when signal is aborted
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            reject(abortError);
          });
        }
      });
    });

    const promise = fetchJsonWithTimeout(
      "/api/test",
      { method: "GET" },
      "Fallback",
      50 // 50ms timeout
    );

    // Fast-forward past the timeout
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toMatchObject({
      message: "Request timed out after 0s", // 50ms rounds to 0s
      status: 408,
      code: "TIMEOUT"
    });
  });

  it("uses custom timeout value", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    // Mock fetch to reject with abort error when signal is aborted
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            reject(abortError);
          });
        }
      });
    });

    const promise = fetchJsonWithTimeout(
      "/api/test",
      { method: "GET" },
      "Fallback",
      5000 // 5 second timeout
    );

    vi.advanceTimersByTime(6000);

    await expect(promise).rejects.toMatchObject({
      message: "Request timed out after 5s",
      status: 408,
      code: "TIMEOUT"
    });
  });

  it("clears timeout on success", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "test" })
    });

    await fetchJsonWithTimeout("/api/test", { method: "GET" }, "Fallback");

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("clears timeout on error", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Error" })
    });

    await expect(
      fetchJsonWithTimeout("/api/test", { method: "GET" }, "Fallback")
    ).rejects.toThrow();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("passes request init options to fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });

    await fetchJsonWithTimeout(
      "/api/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true })
      },
      "Fallback"
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"test":true}'
      })
    );
  });

  it("uses default 30s timeout", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });

    await fetchJsonWithTimeout("/api/test", { method: "GET" }, "Fallback");

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it("re-throws non-abort errors", async () => {
    const networkError = new Error("Network failure");

    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(
      fetchJsonWithTimeout("/api/test", { method: "GET" }, "Fallback")
    ).rejects.toThrow("Network failure");
  });
});
