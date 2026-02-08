export const MAX_RETRIES = 5;
export const MAX_BACKOFF_MS = 60000;

export function getBackoffDelayMs(retryCount: number): number {
  return Math.min(1000 * 2 ** retryCount, MAX_BACKOFF_MS);
}

export function getNextRetryAt(retryCount: number, now = new Date()): Date {
  return new Date(now.getTime() + getBackoffDelayMs(retryCount));
}

export function shouldStopRetrying(retryCount: number): boolean {
  return retryCount >= MAX_RETRIES;
}

