import { db } from "./schema";
import type { DayNote, SyncQueueItem } from "../types";

const SHEET_DAYNOTE_IDS_KEY_PREFIX = "ptScheduler.sheetDayNoteIds.";

export interface DayNoteSheetSyncResult {
    upserted: number;
    deleted: number;
}

/**
 * Reconcile local day notes against the current Google Sheets snapshot.
 * - Upserts all sheet notes locally.
 * - Deletes local notes that were previously tracked from this sheet but are now missing.
 * - Preserves IDs that still have unsynced local dayNote queue items.
 */
export async function reconcileDayNotesFromSheetSnapshot(
    spreadsheetId: string,
    sheetNotes: DayNote[]
): Promise<DayNoteSheetSyncResult> {
    for (const note of sheetNotes) {
        await db.dayNotes.put(note);
    }

    const currentSheetIds = new Set(
        sheetNotes.map((note) => note.id).filter(Boolean)
    );
    const previouslyTrackedIds = readTrackedSheetDayNoteIds(spreadsheetId);
    const pendingDayNoteIds = await getPendingDayNoteSyncIds();

    let deleted = 0;
    for (const noteId of previouslyTrackedIds) {
        if (currentSheetIds.has(noteId)) {
            continue;
        }
        if (pendingDayNoteIds.has(noteId)) {
            continue;
        }

        const existing = await db.dayNotes.get(noteId);
        if (!existing) {
            continue;
        }

        await db.dayNotes.delete(noteId);
        deleted += 1;
    }

    writeTrackedSheetDayNoteIds(spreadsheetId, currentSheetIds);
    return {
        upserted: sheetNotes.length,
        deleted,
    };
}

function readTrackedSheetDayNoteIds(spreadsheetId: string): Set<string> {
    if (typeof window === "undefined") {
        return new Set<string>();
    }

    const raw = window.localStorage.getItem(getSheetDayNoteIdsStorageKey(spreadsheetId));
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

function writeTrackedSheetDayNoteIds(spreadsheetId: string, ids: Set<string>): void {
    if (typeof window === "undefined") {
        return;
    }

    const serialized = JSON.stringify([...ids]);
    window.localStorage.setItem(getSheetDayNoteIdsStorageKey(spreadsheetId), serialized);
}

function getSheetDayNoteIdsStorageKey(spreadsheetId: string): string {
    return `${SHEET_DAYNOTE_IDS_KEY_PREFIX}${spreadsheetId}`;
}

async function getPendingDayNoteSyncIds(): Promise<Set<string>> {
    const items = await db.syncQueue.toArray();
    const pendingIds = new Set<string>();

    for (const item of items) {
        if (item.entity !== "dayNote") {
            continue;
        }
        if (item.status === "synced") {
            continue;
        }

        const entityId = getEntityId(item);
        if (entityId) {
            pendingIds.add(entityId);
        }
    }

    return pendingIds;
}

function getEntityId(item: SyncQueueItem): string {
    return item.data.entityId;
}
