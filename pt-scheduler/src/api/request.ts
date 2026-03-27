import { ApiError, assertOk } from "../utils/apiError";

/** Add timeout to any fetch call without changing error handling. */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Combine caller's signal with our timeout signal so either can abort
  let combinedSignal: AbortSignal;
  if (init.signal) {
    if (typeof AbortSignal.any === "function") {
      combinedSignal = AbortSignal.any([controller.signal, init.signal]);
    } else {
      // Fallback: listen on caller's signal and forward abort to our controller
      const callerSignal = init.signal;
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      combinedSignal = controller.signal;
    }
  } else {
    combinedSignal = controller.signal;
  }

  try {
    return await fetch(input, {
      ...init,
      signal: combinedSignal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // If the caller's signal triggered the abort, re-throw as-is (not a timeout)
      if (init.signal?.aborted) {
        throw err;
      }
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

