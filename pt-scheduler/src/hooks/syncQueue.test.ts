import { describe, expect, it } from "vitest";
import { SyncQueueItem } from "../types";
import { markFailure, markProcessing, markSuccess, takeBatch } from "./syncQueue";

function makeItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 1,
    type: "create",
    entity: "appointment",
    data: { id: "apt-1" },
    timestamp: new Date("2026-02-07T12:00:00.000Z"),
    retryCount: 0,
    status: "pending",
    ...overrides
  };
}

describe("syncQueue", () => {
  it("creates idempotency key when processing", () => {
    const item = markProcessing(makeItem());
    expect(item.status).toBe("processing");
    expect(item.idempotencyKey).toBe("appointment:create:apt-1");
  });

  it("applies backoff on failure before max retries", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const failed = markFailure(makeItem({ retryCount: 1 }), "network error", now);

    expect(failed.status).toBe("pending");
    expect(failed.retryCount).toBe(2);
    expect(failed.lastError).toBe("network error");
    expect(failed.nextRetryAt).toBeDefined();
    expect(failed.nextRetryAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("stops retrying at max retries", () => {
    const failed = markFailure(makeItem({ retryCount: 4 }), "hard failure");
    expect(failed.status).toBe("failed");
    expect(failed.retryCount).toBe(5);
    expect(failed.nextRetryAt).toBeUndefined();
  });

  it("takes only ready items in batch", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const ready = makeItem({ id: 1 });
    const deferred = makeItem({
      id: 2,
      nextRetryAt: new Date("2026-02-07T12:05:00.000Z")
    });

    const snapshot = takeBatch([ready, deferred], 5, now);
    expect(snapshot.ready).toHaveLength(1);
    expect(snapshot.ready[0].id).toBe(1);
    expect(snapshot.deferred).toHaveLength(1);
    expect(snapshot.deferred[0].id).toBe(2);
  });

  it("marks successful items as synced", () => {
    const synced = markSuccess(makeItem({ status: "processing" }));
    expect(synced.status).toBe("synced");
    expect(synced.lastError).toBeUndefined();
  });
});

