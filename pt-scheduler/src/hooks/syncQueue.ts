import { SyncQueueItem } from "../types";
import { getNextRetryAt, shouldStopRetrying } from "../utils/backoff";

let idCounter = 0;
function generateFallbackId(): string {
  return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface QueueSnapshot {
  ready: SyncQueueItem[];
  deferred: SyncQueueItem[];
}

export function isReady(item: SyncQueueItem, now = new Date()): boolean {
  if (item.status !== "pending") return false;
  if (!item.nextRetryAt) return true;
  return item.nextRetryAt <= now;
}

export function takeBatch(
  items: SyncQueueItem[],
  maxItems: number,
  now = new Date()
): QueueSnapshot {
  const ready = items.filter((item) => isReady(item, now)).slice(0, maxItems);
  const readyIds = new Set(ready.map((item) => item.id));
  const deferred = items.filter((item) => !readyIds.has(item.id));

  return { ready, deferred };
}

export function makeIdempotencyKey(item: SyncQueueItem): string {
  if (item.idempotencyKey) return item.idempotencyKey;

  const dataId =
    typeof item.data.id === "string" || typeof item.data.id === "number"
      ? String(item.data.id)
      : generateFallbackId();

  return `${item.entity}:${item.type}:${dataId}`;
}

export function markProcessing(item: SyncQueueItem): SyncQueueItem {
  return {
    ...item,
    status: "processing",
    idempotencyKey: makeIdempotencyKey(item)
  };
}

export function markSuccess(item: SyncQueueItem): SyncQueueItem {
  return {
    ...item,
    status: "synced",
    lastError: undefined,
    nextRetryAt: undefined
  };
}

export function markFailure(
  item: SyncQueueItem,
  errorMessage: string,
  now = new Date()
): SyncQueueItem {
  const retryCount = item.retryCount + 1;

  if (shouldStopRetrying(retryCount)) {
    return {
      ...item,
      retryCount,
      status: "failed",
      lastError: errorMessage,
      nextRetryAt: undefined
    };
  }

  return {
    ...item,
    retryCount,
    status: "pending",
    lastError: errorMessage,
    nextRetryAt: getNextRetryAt(retryCount, now)
  };
}

