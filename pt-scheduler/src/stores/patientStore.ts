import { create } from "zustand";
import type { Patient, PatientStatus } from "../types";
import { appointmentDB, patientDB, syncQueueDB } from "../db/operations";
import { useSyncStore } from "./syncStore";
import { enqueueAppointmentSync, type MutationOptions } from "./appointmentStore";
import { recordUndo, undoValuesEqual, type PatientPatch } from "./undoStore";

interface PatientState {
    patients: Patient[];
    loading: boolean;
    searchQuery: string;
    error: string | null;
}

interface PatientActions {
    loadAll: (status?: PatientStatus) => Promise<void>;
    search: (query: string) => Promise<void>;
    getById: (id: string) => Patient | undefined;
    add: (patient: Omit<Patient, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    update: (id: string, changes: Partial<Omit<Patient, "id" | "createdAt">>, opts?: MutationOptions) => Promise<void>;
    discharge: (id: string) => Promise<void>;
    markForOtherPt: (id: string) => Promise<void>;
    reactivate: (id: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
    clearError: () => void;
}

function hasSpreadsheetSyncConfigured(): boolean {
    const spreadsheetId = useSyncStore.getState().spreadsheetId;
    return Boolean(spreadsheetId.trim());
}

async function enqueuePatientSync(
    type: "create" | "update" | "delete",
    entityId: string
): Promise<void> {
    if (!hasSpreadsheetSyncConfigured()) {
        return;
    }

    await syncQueueDB.add({
        type,
        entity: "patient",
        data: { entityId },
    });
    await useSyncStore.getState().refreshPendingCount();
}

/**
 * A Google Calendar event's title is the patient's name and its location is
 * their address, but nothing re-pushes those when the patient record changes —
 * only appointment-entity queue items write to the calendar. So fan out an
 * update for the patient's already-synced appointments and let the queue's
 * existing handler re-read the fresh patient at push time.
 */
async function enqueueCalendarRefreshForPatient(patientId: string): Promise<void> {
    const affected = await appointmentDB.byPatient(patientId);
    for (const appointment of affected) {
        // No calendarEventId means it isn't on the calendar yet; its own
        // pending "create" will pick up the new values.
        if (appointment.calendarEventId && appointment.status !== "cancelled") {
            await enqueueAppointmentSync("update", appointment.id);
        }
    }
}

export const usePatientStore = create<PatientState & PatientActions>((set, get) => ({
    patients: [],
    loading: false,
    searchQuery: "",
    error: null,

    loadAll: async (status?: PatientStatus) => {
        set({ loading: true, error: null });
        try {
            const patients = await patientDB.getAll(status);
            set({ patients, loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load patients",
                loading: false
            });
        }
    },

    search: async (query: string) => {
        set({ searchQuery: query, loading: true, error: null });
        try {
            if (!query.trim()) {
                const patients = await patientDB.getAll();
                set({ patients, loading: false });
            } else {
                const patients = await patientDB.search(query);
                set({ patients, loading: false });
            }
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Search failed",
                loading: false
            });
        }
    },

    getById: (id: string) => {
        return get().patients.find((p) => p.id === id);
    },

    add: async (patient) => {
        set({ loading: true, error: null });
        try {
            const id = await patientDB.add(patient);
            await enqueuePatientSync("create", id);
            const newPatient = await patientDB.get(id);
            if (newPatient) {
                set((state) => ({
                    patients: [...state.patients, newPatient],
                }));
            }
            set({ loading: false });
            return id;
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to add patient",
                loading: false
            });
            throw err;
        }
    },

    update: async (id, changes, opts) => {
        set({ error: null });
        try {
            const existing = await patientDB.get(id);
            const nameChanged =
                changes.fullName !== undefined &&
                existing !== undefined &&
                changes.fullName.trim() !== existing.fullName;
            const addressChanged =
                changes.address !== undefined &&
                existing !== undefined &&
                changes.address !== existing.address;

            // If address changed and no explicit new coords came along, null out
            // lat/lng so the next geocode pass re-resolves the new address.
            // Prevents stale coordinates from silently sticking to a new address.
            const finalChanges: Partial<Omit<Patient, "id" | "createdAt">> =
                changes.address !== undefined && changes.lat === undefined && changes.lng === undefined
                    ? { ...changes, lat: undefined, lng: undefined }
                    : changes;
            await patientDB.update(id, finalChanges);

            // Key `before` off finalChanges, not changes: an address edit also
            // nulls lat/lng above, and undoing it must restore the geocode too.
            // patientDB.update rethrows, so recording here can't outlive a failure.
            if (opts?.record !== false && existing) {
                const before: PatientPatch = {};
                const after: PatientPatch = {};
                let differs = false;

                for (const key of Object.keys(finalChanges) as (keyof PatientPatch)[]) {
                    const prevValue = existing[key as keyof Patient];
                    const nextValue = finalChanges[key];
                    if (!undoValuesEqual(prevValue, nextValue)) differs = true;
                    Object.assign(before, { [key]: prevValue });
                    Object.assign(after, { [key]: nextValue });
                }

                if (differs) {
                    recordUndo({ kind: "patient", patientId: id, before, after });
                }
            }

            await enqueuePatientSync("update", id);
            const updatedPatient = await patientDB.get(id);
            if (updatedPatient) {
                set((state) => ({
                    patients: state.patients.map((p) =>
                        p.id === id ? updatedPatient : p
                    ),
                }));
            }
            if (nameChanged || addressChanged) {
                await enqueueCalendarRefreshForPatient(id);
            }
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to update patient" });
            throw err;
        }
    },

    discharge: async (id: string) => {
        set({ error: null });
        try {
            await patientDB.discharge(id);
            await enqueuePatientSync("update", id);
            set((state) => ({
                patients: state.patients.map((p) =>
                    p.id === id ? { ...p, status: "discharged" as PatientStatus, updatedAt: new Date() } : p
                ),
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to discharge patient" });
        }
    },

    markForOtherPt: async (id: string) => {
        set({ error: null });
        try {
            await patientDB.markForOtherPt(id);
            await enqueuePatientSync("update", id);
            const now = new Date();
            set((state) => ({
                patients: state.patients.map((p) =>
                    p.id === id ? { ...p, status: "for-other-pt" as PatientStatus, forOtherPtAt: now, updatedAt: now } : p
                ),
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to mark patient for other PT" });
        }
    },

    reactivate: async (id: string) => {
        set({ error: null });
        try {
            await patientDB.reactivate(id);
            await enqueuePatientSync("update", id);
            set((state) => ({
                patients: state.patients.map((p) =>
                    p.id === id ? { ...p, status: "active" as PatientStatus, forOtherPtAt: undefined, updatedAt: new Date() } : p
                ),
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to reactivate patient" });
        }
    },

    delete: async (id: string) => {
        set({ error: null });
        try {
            await patientDB.delete(id);
            await enqueuePatientSync("delete", id);
            set((state) => ({
                patients: state.patients.filter((p) => p.id !== id),
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to delete patient" });
            throw err;
        }
    },

    clearError: () => set({ error: null }),
}));
