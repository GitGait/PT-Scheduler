import { db } from "./schema";
import type { SyncQueueItem, VisitTypeDef } from "../types";
import { VISIT_TYPE_CODE_REGEX, isValidVisitTypeColor } from "../utils/visitTypeCodes";

const SHEET_VISIT_TYPE_CODES_KEY_PREFIX = "ptScheduler.sheetVisitTypeCodes.";

export interface VisitTypeSheetSyncResult {
    upserted: number;
    deleted: number;
}

/**
 * Reconcile local visit type config against the current Google Sheets snapshot.
 * - Upserts all sheet rows locally (remote wins).
 * - Deletes local rows previously tracked from this sheet but now missing.
 * - Preserves codes that still have unsynced local visitType queue items.
 *
 * Only stored *overrides and custom types* live in Dexie, so a deletion here
 * can never remove a built-in — worst case, a built-in's row disappears and
 * the effective registry falls back to the frozen compile-time default.
 *
 * Callers must not pass `[]` for "tab missing": `fetchVisitTypesFromSheet`
 * returns `null` in that case and useSync bails before reaching here.
 */
export async function reconcileVisitTypesFromSheetSnapshot(
    spreadsheetId: string,
    sheetTypes: VisitTypeDef[]
): Promise<VisitTypeSheetSyncResult> {
    const pendingCodes = await getPendingVisitTypeSyncCodes();

    let upserted = 0;
    const currentSheetCodes = new Set<string>();

    for (const def of sheetTypes) {
        // A hand-edited sheet is untrusted input — never let a malformed code
        // reach the registry.
        if (!def?.code || !VISIT_TYPE_CODE_REGEX.test(def.code)) {
            continue;
        }

        // Record presence BEFORE any further rejection. A code that is in the
        // sheet but unusable must read as "present, not upserted": if it fell
        // through to the delete pass below it would be silently removed.
        currentSheetCodes.add(def.code);

        if (!isValidVisitTypeColor(def.bg)) {
            continue;
        }
        if (pendingCodes.has(def.code)) {
            continue;
        }

        // Only write when something actually changed. A steady-state sync then
        // reports zero changes, so the caller skips the registry swap and the
        // synced event — which would otherwise fire on every poll tick.
        const existing = await db.visitTypes.get(def.code);
        if (existing && !hasVisitTypeChanged(existing, def)) {
            continue;
        }

        await db.visitTypes.put(def);
        upserted += 1;
    }

    const previouslyTrackedCodes = readTrackedSheetVisitTypeCodes(spreadsheetId);

    let deleted = 0;
    for (const code of previouslyTrackedCodes) {
        if (currentSheetCodes.has(code) || pendingCodes.has(code)) {
            continue;
        }

        const existing = await db.visitTypes.get(code);
        if (!existing) {
            continue;
        }

        await db.visitTypes.delete(code);
        deleted += 1;
    }

    writeTrackedSheetVisitTypeCodes(spreadsheetId, currentSheetCodes);
    return { upserted, deleted };
}

/**
 * Compare only the user-meaningful fields. `createdAt`/`updatedAt` are both
 * derived from the sheet's single `updatedAt` cell, so they carry no signal
 * beyond what the other fields already show.
 */
function hasVisitTypeChanged(existing: VisitTypeDef, incoming: VisitTypeDef): boolean {
    return (
        existing.label !== incoming.label ||
        existing.bg !== incoming.bg ||
        existing.hidden !== incoming.hidden ||
        existing.sortOrder !== incoming.sortOrder
    );
}

function readTrackedSheetVisitTypeCodes(spreadsheetId: string): Set<string> {
    if (typeof window === "undefined") {
        return new Set<string>();
    }

    const raw = window.localStorage.getItem(getStorageKey(spreadsheetId));
    if (!raw) {
        return new Set<string>();
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set<string>();
        }
        return new Set(
            parsed
                .map((value) => (typeof value === "string" ? value.trim() : ""))
                .filter(Boolean)
        );
    } catch {
        return new Set<string>();
    }
}

function writeTrackedSheetVisitTypeCodes(spreadsheetId: string, codes: Set<string>): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(getStorageKey(spreadsheetId), JSON.stringify([...codes]));
}

function getStorageKey(spreadsheetId: string): string {
    return `${SHEET_VISIT_TYPE_CODES_KEY_PREFIX}${spreadsheetId}`;
}

async function getPendingVisitTypeSyncCodes(): Promise<Set<string>> {
    const items = await db.syncQueue.toArray();
    const pending = new Set<string>();

    for (const item of items) {
        if (item.entity !== "visitType" || item.status === "synced") {
            continue;
        }
        const entityId = getEntityId(item);
        if (entityId) {
            pending.add(entityId);
        }
    }

    return pending;
}

function getEntityId(item: SyncQueueItem): string {
    return item.data.entityId;
}
