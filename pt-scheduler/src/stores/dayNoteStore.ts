import { create } from "zustand";
import type { DayNote, SyncAction } from "../types";
import { dayNoteDB, syncQueueDB } from "../db/operations";
import { useSyncStore } from "./syncStore";

interface DayNoteState {
    notes: DayNote[];
    loading: boolean;
    error: string | null;
}

interface DayNoteActions {
    loadByRange: (startDate: string, endDate: string) => Promise<void>;
    create: (note: Omit<DayNote, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    update: (id: string, changes: Partial<Omit<DayNote, "id" | "createdAt">>) => Promise<void>;
    moveNote: (id: string, date: string, startMinutes: number) => Promise<void>;
    delete: (id: string) => Promise<void>;
    clearError: () => void;
}

function hasSheetsSyncConfigured(): boolean {
    const spreadsheetId = useSyncStore.getState().spreadsheetId;
    return Boolean(spreadsheetId.trim());
}

async function enqueueDayNoteSync(type: SyncAction, entityId: string): Promise<void> {
    if (!hasSheetsSyncConfigured()) return;
    await syncQueueDB.add({
        type,
        entity: "dayNote",
        data: { entityId },
    });
    await useSyncStore.getState().refreshPendingCount();
}

export const useDayNoteStore = create<DayNoteState & DayNoteActions>((set, get) => ({
    notes: [],
    loading: false,
    error: null,

    loadByRange: async (startDate: string, endDate: string) => {
        const isInitialLoad = get().notes.length === 0;
        set({ loading: isInitialLoad, error: null });
        try {
            const notes = await dayNoteDB.byRange(startDate, endDate);
            set({ notes, loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load day notes",
                loading: false,
            });
        }
    },

    create: async (note) => {
        set({ error: null });
        try {
            const id = await dayNoteDB.create(note);
            const newNote = await dayNoteDB.get(id);
            const noteToStore = newNote ?? {
                ...note,
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
            } as DayNote;
            set((state) => ({ notes: [...state.notes, noteToStore] }));
            await enqueueDayNoteSync("create", id);
            return id;
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to create day note",
            });
            throw err;
        }
    },

    update: async (id, changes) => {
        set({ error: null });
        const previous = get().notes.find((n) => n.id === id);
        const optimisticUpdatedAt = new Date();
        set((state) => ({
            notes: state.notes.map((n) =>
                n.id === id ? { ...n, ...changes, updatedAt: optimisticUpdatedAt } : n
            ),
        }));

        try {
            await dayNoteDB.update(id, changes);
            await enqueueDayNoteSync("update", id);
        } catch (err) {
            set((state) => ({
                error: err instanceof Error ? err.message : "Failed to update day note",
                notes: previous
                    ? state.notes.map((n) => (n.id === id ? previous : n))
                    : state.notes,
            }));
        }
    },

    moveNote: async (id, date, startMinutes) => {
        set({ error: null });
        const previous = get().notes.find((n) => n.id === id);
        const optimisticUpdatedAt = new Date();
        set((state) => ({
            notes: state.notes.map((n) =>
                n.id === id ? { ...n, date, startMinutes, updatedAt: optimisticUpdatedAt } : n
            ),
        }));

        try {
            await dayNoteDB.update(id, { date, startMinutes });
            await enqueueDayNoteSync("update", id);
        } catch (err) {
            set((state) => ({
                error: err instanceof Error ? err.message : "Failed to move day note",
                notes: previous
                    ? state.notes.map((n) => (n.id === id ? previous : n))
                    : state.notes,
            }));
        }
    },

    delete: async (id) => {
        set({ error: null });
        const previous = get().notes;
        set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));

        try {
            await dayNoteDB.delete(id);
            await enqueueDayNoteSync("delete", id);
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to delete day note",
                notes: previous,
            });
        }
    },

    clearError: () => set({ error: null }),
}));
