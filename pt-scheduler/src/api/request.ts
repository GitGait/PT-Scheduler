import { ApiError, assertOk } from "../utils/apiError";

/** Add timeout to any fetch call without changing error handling. */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
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

/** Default 30s timeout. Override per-call for endpoints that need more/less. */
export async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
  timeoutMs = 30_000
): Promise<T> {
  const res = await fetchWithTimeout(input, init, timeoutMs);
  await assertOk(res, fallbackMessage);
  return (await res.json()) as T;
}

