import type { Appointment, Patient } from "../types";
import { appointmentDB, patientDB } from "../db/operations";
import { useAppointmentStore } from "./appointmentStore";
import { usePatientStore } from "./patientStore";
import { markLocalMutation } from "../utils/mutationCooldown";
import {
    useUndoStore,
    resolveUndoId,
    undoValuesEqual,
    UNDO_STACK_LIMIT,
    type UndoEntry,
    type UndoPrimitiveEntry,
    type AppointmentPatch,
    type PatientPatch,
} from "./undoStore";

const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";

export type UndoResult = { status: "applied"; label: string } | { status: "empty" };

/**
 * Deletes an appointment and asks the sync layer to catch up.
 *
 * A plain module function rather than a hook return value on purpose:
 * SchedulePage subscribes to stores without a selector, so anything it can only
 * reach through a hook would re-render the whole page on every undo push.
 */
export async function deleteAppointmentWithSync(id: string): Promise<void> {
    markLocalMutation();
    await useAppointmentStore.getState().delete(id);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
    }
}

/**
 * Builds the patch that reverts `before`, dropping any key someone else has
 * changed since we recorded it. Comparing current against the recorded `after`
 * is what makes undo conflict-safe instead of last-writer-wins.
 */
export function computeRevertPatch<T extends object, P extends Partial<Record<keyof T, unknown>>>(
    current: T,
    before: P,
    after: P
): Partial<P> {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(before)) {
        const currentValue = (current as Record<string, unknown>)[key];
        const recordedAfter = (after as Record<string, unknown>)[key];
        // Someone else wrote this field after we recorded — leave it alone.
        if (!undoValuesEqual(currentValue, recordedAfter)) continue;
        patch[key] = (before as Record<string, unknown>)[key];
    }
    return patch as Partial<P>;
}

async function findAppointment(id: string): Promise<Appointment | undefined> {
    const state = useAppointmentStore.getState();
    return (
        state.appointments.find((a) => a.id === id) ??
        state.onHoldAppointments.find((a) => a.id === id) ??
        (await appointmentDB.get(id))
    );
}

async function findPatient(id: string): Promise<Patient | undefined> {
    return usePatientStore.getState().patients.find((p) => p.id === id) ?? (await patientDB.get(id));
}

/**
 * Applies one primitive entry.
 *
 * Returns false when the entry is stale — the row it targets is gone, or every
 * field it wanted to revert has since been changed by someone else. The caller
 * drops it and moves on to the next entry.
 *
 * Every store call passes `{ record: false }` explicitly. A global suppression
 * counter is deliberately NOT used: applies are async, and a counter held
 * across an `await` would swallow a concurrent user gesture.
 */
async function applyPrimitive(entry: UndoPrimitiveEntry): Promise<boolean> {
    switch (entry.kind) {
        case "update": {
            const id = resolveUndoId(entry.appointmentId);
            const current = await findAppointment(id);
            if (!current) return false;

            const patch = computeRevertPatch<Appointment, AppointmentPatch>(current, entry.before, entry.after);
            if (Object.keys(patch).length === 0) return false;

            markLocalMutation();
            await useAppointmentStore.getState().update(id, patch, { record: false });
            return true;
        }

        case "patient": {
            const current = await findPatient(entry.patientId);
            if (!current) return false;

            const patch = computeRevertPatch<Patient, PatientPatch>(current, entry.before, entry.after);
            if (Object.keys(patch).length === 0) return false;

            markLocalMutation();
            await usePatientStore.getState().update(entry.patientId, patch, { record: false });
            return true;
        }

        case "create": {
            const id = resolveUndoId(entry.appointmentId);
            const current = await findAppointment(id);
            if (!current) return false;

            markLocalMutation();
            await useAppointmentStore.getState().delete(id, { record: false });
            return true;
        }

        case "hold": {
            const id = resolveUndoId(entry.appointmentId);
            markLocalMutation();

            // restoreFromHold bypasses update() entirely, so it records nothing
            // and needs no opt-out. It returns undefined when the row is no
            // longer on hold — e.g. the Sidebar already restored it.
            const restored = await useAppointmentStore.getState().restoreFromHold(id);
            if (!restored) return false;

            if (entry.previousStatus !== "scheduled") {
                await useAppointmentStore
                    .getState()
                    .update(id, { status: entry.previousStatus }, { record: false });
            }
            return true;
        }

        case "delete": {
            // A re-create, not a revival: the original uuid and Google event are
            // both genuinely gone. syncStatus "local" is load-bearing —
            // loadByRange's merge only preserves pending/local/mutating.
            //
            // The tombstone on the old id is deliberately NOT cleared. It only
            // survives when the Google delete failed or was queued, meaning the
            // event may still exist upstream; clearing it would let the next
            // pull re-import that ghost beside the row we just restored.
            markLocalMutation();
            const newId = await useAppointmentStore
                .getState()
                .create({ ...entry.snapshot, syncStatus: "local" }, { record: false });

            useUndoStore.getState().registerRemap(entry.appointmentId, newId);
            return true;
        }
    }
}

async function applyEntry(entry: UndoEntry): Promise<boolean> {
    if (entry.kind !== "batch") {
        return applyPrimitive(entry);
    }

    // Newest-first, and sequential rather than Promise.all so the sync queue
    // keeps its ordering.
    let anyApplied = false;
    for (let i = entry.children.length - 1; i >= 0; i -= 1) {
        try {
            const applied = await applyPrimitive(entry.children[i]);
            if (applied) anyApplied = true;
        } catch (err) {
            console.warn("Undo: batch child failed, continuing", err);
        }
    }
    return anyApplied;
}

/**
 * Pops the newest entry and applies it, skipping past entries that have gone
 * stale. Bounded by the stack limit so a fully-stale history can't spin.
 *
 * Concurrency: `pop()` is synchronous, so two overlapping calls take different
 * entries off the stack and can never apply the same one twice.
 */
export async function applyNextUndo(): Promise<UndoResult> {
    for (let attempts = 0; attempts < UNDO_STACK_LIMIT; attempts += 1) {
        const entry = useUndoStore.getState().pop();
        if (!entry) return { status: "empty" };

        try {
            const applied = await applyEntry(entry);
            if (applied) return { status: "applied", label: entry.label };
        } catch (err) {
            console.warn("Undo: entry failed, dropping and continuing", err);
        }
    }

    return { status: "empty" };
}
