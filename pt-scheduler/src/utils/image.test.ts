import { describe, expect, it, vi } from "vitest";
import { validateImageSize, MAX_IMAGE_SIZE_BYTES } from "./image";

describe("validateImageSize", () => {
  it("accepts small base64 image", () => {
    // Small valid data URL
    const smallImage = "data:image/png;base64," + "A".repeat(1000);
    expect(() => validateImageSize(smallImage)).not.toThrow();
  });

  it("accepts image at the size limit", () => {
    // Create a base64 string that's just under 4MB
    // 4MB = 4 * 1024 * 1024 = 4,194,304 bytes
    // Base64 is ~33% larger than raw, so max chars is about 5.6M
    const justUnderLimit = "data:image/png;base64," + "A".repeat(5_000_000);
    expect(() => validateImageSize(justUnderLimit)).not.toThrow();
  });

  it("rejects image over the size limit", () => {
    // Create a base64 string that's over 4MB decoded
    // Need about 5.6M chars to exceed 4MB decoded
    const overLimit = "data:image/png;base64," + "A".repeat(6_000_000);
    expect(() => validateImageSize(overLimit)).toThrow(/too large/i);
  });

  it("includes size in error message", () => {
    const overLimit = "data:image/png;base64," + "A".repeat(6_000_000);
    expect(() => validateImageSize(overLimit)).toThrow(/\d+MB/);
  });

  it("includes maximum size in error message", () => {
    const overLimit = "data:image/png;base64," + "A".repeat(6_000_000);
    expect(() => validateImageSize(overLimit)).toThrow(/Maximum size is 4MB/);
  });
});

describe("MAX_IMAGE_SIZE_BYTES constant", () => {
  it("is 2MB", () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});
