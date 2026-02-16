import { db } from "./schema";
import type { Patient, SyncQueueItem } from "../types";

const SHEET_PATIENT_IDS_KEY_PREFIX = "ptScheduler.sheetPatientIds.";

export interface PatientSheetSyncResult {
    upserted: number;
    deleted: number;
}

/**
 * Reconcile local patients against the current Google Sheets snapshot.
 * - Upserts all sheet patients locally.
 * - Deletes local patients that were previously tracked from this sheet but are now missing.
 * - Preserves IDs that still have unsynced local patient queue items.
 */
export async function reconcilePatientsFromSheetSnapshot(
    spreadsheetId: string,
    sheetPatients: Patient[]
): Promise<PatientSheetSyncResult> {
    for (const patient of sheetPatients) {
        const existing = await db.patients.get(patient.id);
        if (existing?.chipNote && !patient.chipNote) {
            patient.chipNote = existing.chipNote;
        }
        await db.patients.put(patient);
    }

    const currentSheetIds = new Set(
        sheetPatients.map((patient) => patient.id).filter(Boolean)
    );
    const previouslyTrackedIds = readTrackedSheetPatientIds(spreadsheetId);
    const pendingPatientIds = await getPendingPatientSyncIds();

    let deleted = 0;
    for (const patientId of previouslyTrackedIds) {
        if (currentSheetIds.has(patientId)) {
            continue;
        }
        if (pendingPatientIds.has(patientId)) {
            continue;
        }

        const existing = await db.patients.get(patientId);
        if (!existing) {
            continue;
        }

        await db.patients.delete(patientId);
        deleted += 1;
    }

    writeTrackedSheetPatientIds(spreadsheetId, currentSheetIds);
    return {
        upserted: sheetPatients.length,
        deleted,
    };
}

function readTrackedSheetPatientIds(spreadsheetId: string): Set<string> {
    if (typeof window === "undefined") {
        return new Set<string>();
    }

    const raw = window.localStorage.getItem(getSheetPatientIdsStorageKey(spreadsheetId));
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

function writeTrackedSheetPatientIds(spreadsheetId: string, ids: Set<string>): void {
    if (typeof window === "undefined") {
        return;
    }

    const serialized = JSON.stringify([...ids]);
    window.localStorage.setItem(getSheetPatientIdsStorageKey(spreadsheetId), serialized);
}

function getSheetPatientIdsStorageKey(spreadsheetId: string): string {
    return `${SHEET_PATIENT_IDS_KEY_PREFIX}${spreadsheetId}`;
}

async function getPendingPatientSyncIds(): Promise<Set<string>> {
    const items = await db.syncQueue.toArray();
    const pendingIds = new Set<string>();

    for (const item of items) {
        if (item.entity !== "patient") {
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
