import { describe, expect, it, vi } from "vitest";
import { ApiError, assertOk, toErrorPayload } from "./apiError";

describe("ApiError", () => {
  it("creates error with message and default status", () => {
    const error = new ApiError("Something went wrong");
    expect(error.message).toBe("Something went wrong");
    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
    expect(error.name).toBe("ApiError");
  });

  it("creates error with custom status", () => {
    const error = new ApiError("Not found", 404);
    expect(error.message).toBe("Not found");
    expect(error.status).toBe(404);
  });

  it("creates error with custom code", () => {
    const error = new ApiError("Rate limited", 429, "RATE_LIMIT");
    expect(error.message).toBe("Rate limited");
    expect(error.status).toBe(429);
    expect(error.code).toBe("RATE_LIMIT");
  });

  it("is instanceof Error", () => {
    const error = new ApiError("Test");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe("assertOk", () => {
  it("does not throw for ok response", async () => {
    const response = new Response(null, { status: 200 });
    await expect(assertOk(response, "Fallback")).resolves.toBeUndefined();
  });

  it("does not throw for 201 response", async () => {
    const response = new Response(null, { status: 201 });
    await expect(assertOk(response, "Fallback")).resolves.toBeUndefined();
  });

  it("throws ApiError with fallback message for non-ok response without body", async () => {
    const response = new Response(null, { status: 500 });
    await expect(assertOk(response, "Fallback message")).rejects.toMatchObject({
      message: "Fallback message",
      status: 500
    });
  });

  it("extracts error message from JSON body", async () => {
    const response = new Response(JSON.stringify({ error: "Custom error" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
    await expect(assertOk(response, "Fallback")).rejects.toMatchObject({
      message: "Custom error",
      status: 400
    });
  });

  it("extracts error code from JSON body", async () => {
    const response = new Response(
      JSON.stringify({ error: "Bad request", code: "VALIDATION_ERROR" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
    await expect(assertOk(response, "Fallback")).rejects.toMatchObject({
      message: "Bad request",
      status: 400,
      code: "VALIDATION_ERROR"
    });
  });

  it("uses fallback message if JSON body has empty error", async () => {
    const response = new Response(JSON.stringify({ error: "" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
    await expect(assertOk(response, "Fallback")).rejects.toMatchObject({
      message: "Fallback"
    });
  });

  it("uses fallback message if JSON body has whitespace-only error", async () => {
    const response = new Response(JSON.stringify({ error: "   " }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
    await expect(assertOk(response, "Fallback")).rejects.toMatchObject({
      message: "Fallback"
    });
  });

  it("uses fallback message if JSON parse fails", async () => {
    const response = new Response("not json", { status: 500 });
    await expect(assertOk(response, "Fallback")).rejects.toMatchObject({
      message: "Fallback",
      status: 500
    });
  });

  it("ignores code if whitespace-only", async () => {
    const response = new Response(
      JSON.stringify({ error: "Error", code: "  " }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
    const promise = assertOk(response, "Fallback");
    await expect(promise).rejects.toMatchObject({
      code: undefined
    });
  });
});

describe("toErrorPayload", () => {
  it("converts ApiError to payload", () => {
    const error = new ApiError("API failed", 502, "UPSTREAM_ERROR");
    const payload = toErrorPayload(error);
    expect(payload).toEqual({
      error: "API failed",
      code: "UPSTREAM_ERROR"
    });
  });

  it("uses fallback code if ApiError has no code", () => {
    const error = new ApiError("Failed", 500);
    const payload = toErrorPayload(error, "DEFAULT_CODE");
    expect(payload).toEqual({
      error: "Failed",
      code: "DEFAULT_CODE"
    });
  });

  it("converts regular Error to payload", () => {
    const error = new Error("Something broke");
    const payload = toErrorPayload(error);
    expect(payload).toEqual({
      error: "Something broke",
      code: "INTERNAL_ERROR"
    });
  });

  it("converts regular Error with custom fallback code", () => {
    const error = new Error("Timeout");
    const payload = toErrorPayload(error, "TIMEOUT");
    expect(payload).toEqual({
      error: "Timeout",
      code: "TIMEOUT"
    });
  });

  it("handles non-Error objects", () => {
    const payload = toErrorPayload("string error");
    expect(payload).toEqual({
      error: "Unexpected error",
      code: "INTERNAL_ERROR"
    });
  });

  it("handles null", () => {
    const payload = toErrorPayload(null);
    expect(payload).toEqual({
      error: "Unexpected error",
      code: "INTERNAL_ERROR"
    });
  });

  it("handles undefined", () => {
    const payload = toErrorPayload(undefined);
    expect(payload).toEqual({
      error: "Unexpected error",
      code: "INTERNAL_ERROR"
    });
  });
});
