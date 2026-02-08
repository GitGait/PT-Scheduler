import { ApiError, assertOk } from "../utils/apiError";

/** Default 30s timeout. Override per-call for endpoints that need more/less. */
export async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
  timeoutMs = 30_000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    await assertOk(res, fallbackMessage);
    return (await res.json()) as T;
  } catch (err) {
    // Provide clear error message for timeouts
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
        408,
        "TIMEOUT"
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

