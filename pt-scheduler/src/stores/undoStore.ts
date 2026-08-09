import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { Appointment, Patient } from "../types";

/**
 * Multi-step undo history.
 *
 * This module imports nothing from appointmentStore/patientStore — the
 * dependency runs one way (mutation stores -> undoStore) so there is no cycle.
 * The applier that needs both directions lives in undoApply.ts.
 */

/** calendarEventId deliberately omitted — undo-delete re-creates a fresh Google event. */
export type AppointmentSeed = Omit<Appointment, "id" | "createdAt" | "updatedAt" | "calendarEventId">;
export type AppointmentPatch = Partial<Omit<Appointment, "id" | "createdAt">>;
export type PatientPatch = Partial<Omit<Patient, "id" | "createdAt">>;

interface UndoEntryBase {
    entryId: string;
    at: number;
    label: string;
}

export type UndoUpdateReason = "move" | "resize" | "note" | "detail";

export interface UndoUpdateEntry extends UndoEntryBase {
    kind: "update";
    reason: UndoUpdateReason;
    appointmentId: string;
    /** Only the keys the caller actually changed. */
    before: AppointmentPatch;
    /** The same keys post-change — used for conflict detection at apply time. */
    after: AppointmentPatch;
}

export interface UndoPatientEntry extends UndoEntryBase {
    kind: "patient";
    patientId: string;
    before: PatientPatch;
    after: PatientPatch;
}

export interface UndoHoldEntry extends UndoEntryBase {
    kind: "hold";
    appointmentId: string;
    previousStatus: Appointment["status"];
}

export interface UndoCreateEntry extends UndoEntryBase {
    kind: "create";
    appointmentId: string;
}

export interface UndoDeleteEntry extends UndoEntryBase {
    kind: "delete";
    /** The destroyed uuid — drives id remapping once undo mints a new one. */
    appointmentId: string;
    snapshot: AppointmentSeed;
    /** Diagnostics only; never reused. See the tombstone policy in the plan. */
    calendarEventId?: string;
}

export type UndoBatchSource = "clear-week" | "auto-arrange" | "recurring-edit" | "multi";

export interface UndoBatchEntry extends UndoEntryBase {
    kind: "batch";
    source: UndoBatchSource;
    /** Applied newest-first. */
    children: UndoPrimitiveEntry[];
}

export type UndoPrimitiveEntry =
    | UndoUpdateEntry
    | UndoPatientEntry
    | UndoHoldEntry
    | UndoCreateEntry
    | UndoDeleteEntry;

export type UndoEntry = UndoPrimitiveEntry | UndoBatchEntry;

/** Distributes over the union so each member drops its own generated fields. */
type WithoutMeta<T> = T extends unknown ? Omit<T, "entryId" | "at" | "label"> : never;
export type UndoEntryInput = WithoutMeta<UndoPrimitiveEntry>;

export const UNDO_STACK_LIMIT = 20;

interface UndoState {
    entries: UndoEntry[];
    idRemap: Record<string, string>;
}

interface UndoActions {
    push: (entry: UndoEntry) => void;
    pop: () => UndoEntry | undefined;
    registerRemap: (oldId: string, newId: string) => void;
    clearHistory: () => void;
}

export const useUndoStore = create<UndoState & UndoActions>((set, get) => ({
    entries: [],
    idRemap: {},

    push: (entry) => {
        set((state) => {
            const next = [...state.entries, entry];
            return { entries: next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next };
        });
    },

    pop: () => {
        const { entries } = get();
        if (entries.length === 0) return undefined;
        const top = entries[entries.length - 1];
        set({ entries: entries.slice(0, -1) });
        return top;
    },

    registerRemap: (oldId, newId) => {
        set((state) => ({ idRemap: { ...state.idRemap, [oldId]: newId } }));
    },

    clearHistory: () => set({ entries: [], idRemap: {} }),
}));

/** Human-readable toast text, derived from the entry itself so call sites never pass display strings. */
export function labelFor(entry: UndoEntryInput): string {
    switch (entry.kind) {
        case "create":
            return "Appointment added";
        case "delete":
            return "Appointment deleted";
        case "hold":
            return "Moved to On Hold";
        case "patient":
            return "Note updated";
        case "update":
            switch (entry.reason) {
                case "move":
                    return "Appointment moved";
                case "resize":
                    return "Duration changed";
                case "note":
                    return "Note updated";
                default:
                    return "Appointment updated";
            }
    }
}

/**
 * Field-level equality for undo bookkeeping. Handles the two non-primitive
 * shapes that appear in appointment/patient patches: string arrays (chipNotes)
 * and Dates (forOtherPtAt).
 */
export function undoValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return false;
}

/** Infers why an appointment changed, from the keys the caller touched. */
export function inferUpdateReason(changedKeys: string[]): UndoUpdateReason {
    if (changedKeys.includes("date") || changedKeys.includes("startTime")) return "move";
    if (changedKeys.includes("duration")) return "resize";
    if (changedKeys.some((k) => k === "chipNote" || k === "chipNotes" || k === "chipNoteColor" || k === "notes")) {
        return "note";
    }
    return "detail";
}

// --- Suppression ---------------------------------------------------------

let suppressDepth = 0;

/**
 * Suppress recording for the duration of `fn`. Only for synchronous-intent bulk
 * work (the OCR import). The undo applier deliberately does NOT use this — it
 * passes `{ record: false }` explicitly, because a counter held across `await`
 * boundaries would swallow a concurrent user gesture.
 */
export async function runWithoutUndo<T>(fn: () => Promise<T>): Promise<T> {
    suppressDepth += 1;
    try {
        return await fn();
    } finally {
        suppressDepth -= 1;
    }
}

// --- Batching ------------------------------------------------------------

interface OpenBatch {
    source: UndoBatchSource;
    label: string;
    children: UndoPrimitiveEntry[];
    depth: number;
}

let openBatch: OpenBatch | null = null;

export function beginUndoBatch(source: UndoBatchSource, label: string): void {
    if (openBatch) {
        openBatch.depth += 1;
        return;
    }
    openBatch = { source, label, children: [], depth: 1 };
}

/** The id a primitive entry acts on — used to dedupe repeated writes to one row. */
function targetIdOf(entry: UndoPrimitiveEntry): string {
    return entry.kind === "patient" ? entry.patientId : entry.appointmentId;
}

export function endUndoBatch(): void {
    if (!openBatch) return;
    openBatch.depth -= 1;
    if (openBatch.depth > 0) return;

    const { source, label, children } = openBatch;
    openBatch = null;

    // Keep the FIRST child per target: Clear Week's retry loop can issue up to
    // 2N deletes, and the first snapshot is the original state.
    const seen = new Set<string>();
    const deduped: UndoPrimitiveEntry[] = [];
    for (const child of children) {
        const target = targetIdOf(child);
        if (seen.has(target)) continue;
        seen.add(target);
        deduped.push(child);
    }

    if (deduped.length === 0) return;

    useUndoStore.getState().push({
        entryId: uuidv4(),
        at: Date.now(),
        label,
        kind: "batch",
        source,
        children: deduped,
    });
}

export function abortUndoBatch(): void {
    if (!openBatch) return;
    openBatch.depth -= 1;
    if (openBatch.depth > 0) return;
    openBatch = null;
}

// --- Recording -----------------------------------------------------------

export function recordUndo(entry: UndoEntryInput): void {
    if (suppressDepth > 0) return;

    const full = {
        ...entry,
        entryId: uuidv4(),
        at: Date.now(),
        label: labelFor(entry),
    } as UndoPrimitiveEntry;

    if (openBatch) {
        openBatch.children.push(full);
        return;
    }
    useUndoStore.getState().push(full);
}

// --- Id remapping --------------------------------------------------------

/**
 * Follows the remap chain for an id whose row was re-created by an earlier undo.
 * Depth-capped and cycle-guarded so a malformed chain can never spin.
 */
export function resolveUndoId(id: string): string {
    const { idRemap } = useUndoStore.getState();
    const visited = new Set<string>([id]);
    let current = id;
    for (let i = 0; i < UNDO_STACK_LIMIT; i += 1) {
        const next = idRemap[current];
        if (next === undefined || visited.has(next)) return current;
        visited.add(next);
        current = next;
    }
    return current;
}

/** Test seam — resets module-level batch/suppression state between cases. */
export function __resetUndoModuleState(): void {
    openBatch = null;
    suppressDepth = 0;
}
