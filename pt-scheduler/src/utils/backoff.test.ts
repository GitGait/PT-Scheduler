import { describe, expect, it } from "vitest";
import {
  getBackoffDelayMs,
  getNextRetryAt,
  shouldStopRetrying,
  MAX_RETRIES,
  MAX_BACKOFF_MS
} from "./backoff";

describe("backoff", () => {
  describe("getBackoffDelayMs", () => {
    it("returns 1000ms for retry 0", () => {
      expect(getBackoffDelayMs(0)).toBe(1000);
    });

    it("returns 2000ms for retry 1", () => {
      expect(getBackoffDelayMs(1)).toBe(2000);
    });

    it("returns 4000ms for retry 2", () => {
      expect(getBackoffDelayMs(2)).toBe(4000);
    });

    it("returns 8000ms for retry 3", () => {
      expect(getBackoffDelayMs(3)).toBe(8000);
    });

    it("returns 16000ms for retry 4", () => {
      expect(getBackoffDelayMs(4)).toBe(16000);
    });

    it("caps at MAX_BACKOFF_MS for high retry counts", () => {
      expect(getBackoffDelayMs(10)).toBe(MAX_BACKOFF_MS);
      expect(getBackoffDelayMs(100)).toBe(MAX_BACKOFF_MS);
    });

    it("never exceeds 60 seconds", () => {
      for (let i = 0; i < 20; i++) {
        expect(getBackoffDelayMs(i)).toBeLessThanOrEqual(60000);
      }
    });
  });

  describe("getNextRetryAt", () => {
    it("returns a date in the future", () => {
      const now = new Date("2026-02-07T12:00:00.000Z");
      const nextRetry = getNextRetryAt(0, now);
      expect(nextRetry.getTime()).toBeGreaterThan(now.getTime());
    });

    it("adds correct delay to current time", () => {
      const now = new Date("2026-02-07T12:00:00.000Z");
      const nextRetry = getNextRetryAt(2, now); // 4000ms delay
      expect(nextRetry.getTime()).toBe(now.getTime() + 4000);
    });

    it("uses current time if not provided", () => {
      const before = Date.now();
      const nextRetry = getNextRetryAt(0);
      const after = Date.now();

      // Should be roughly now + 1000ms
      expect(nextRetry.getTime()).toBeGreaterThanOrEqual(before + 1000);
      expect(nextRetry.getTime()).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe("shouldStopRetrying", () => {
    it("returns false for retry 0", () => {
      expect(shouldStopRetrying(0)).toBe(false);
    });

    it("returns false for retry 4 (one below max)", () => {
      expect(shouldStopRetrying(MAX_RETRIES - 1)).toBe(false);
    });

    it("returns true for retry 5 (max retries)", () => {
      expect(shouldStopRetrying(MAX_RETRIES)).toBe(true);
    });

    it("returns true for retry counts above max", () => {
      expect(shouldStopRetrying(MAX_RETRIES + 1)).toBe(true);
      expect(shouldStopRetrying(100)).toBe(true);
    });
  });

  describe("constants", () => {
    it("MAX_RETRIES is 5", () => {
      expect(MAX_RETRIES).toBe(5);
    });

    it("MAX_BACKOFF_MS is 60000 (1 minute)", () => {
      expect(MAX_BACKOFF_MS).toBe(60000);
    });
  });
});
