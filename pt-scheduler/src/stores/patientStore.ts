import { create } from "zustand";
import type { Patient, PatientStatus } from "../types";
import { patientDB, syncQueueDB } from "../db/operations";
import { useSyncStore } from "./syncStore";

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
    update: (id: string, changes: Partial<Omit<Patient, "id" | "createdAt">>) => Promise<void>;
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
            const newPatient = await patientDB.get(id);
            if (newPatient) {
                set((state) => ({
                    patients: [...state.patients, newPatient],
                    loading: false,
                }));
            }
            return id;
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to add patient",
                loading: false
            });
            throw err;
        }
    },

    update: async (id, changes) => {
        set({ error: null });
        try {
            await patientDB.update(id, changes);
            await enqueuePatientSync("update", id);
            const updatedPatient = await patientDB.get(id);
            if (updatedPatient) {
                set((state) => ({
                    patients: state.patients.map((p) =>
                        p.id === id ? updatedPatient : p
                    ),
                }));
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
