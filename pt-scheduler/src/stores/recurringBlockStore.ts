import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { RecurringBlock } from "../types";
import { db } from "../db/schema";

interface RecurringBlockState {
    blocks: RecurringBlock[];
    loading: boolean;
    error: string | null;
}

interface RecurringBlockActions {
    loadAll: () => Promise<void>;
    loadByPatient: (patientId: string) => Promise<void>;
    create: (block: Omit<RecurringBlock, "id">) => Promise<string>;
    update: (id: string, changes: Partial<Omit<RecurringBlock, "id">>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    clearError: () => void;
}

export const useRecurringBlockStore = create<RecurringBlockState & RecurringBlockActions>(
    (set) => ({
        blocks: [],
        loading: false,
        error: null,

        loadAll: async () => {
            set({ loading: true, error: null });
            try {
                const blocks = await db.recurringBlocks.toArray();
                set({ blocks, loading: false });
            } catch (err) {
                set({
                    error: err instanceof Error ? err.message : "Failed to load recurring blocks",
                    loading: false,
                });
            }
        },

        loadByPatient: async (patientId: string) => {
            set({ loading: true, error: null });
            try {
                const blocks = await db.recurringBlocks.where("patientId").equals(patientId).toArray();
                set({ blocks, loading: false });
            } catch (err) {
                set({
                    error: err instanceof Error ? err.message : "Failed to load recurring blocks",
                    loading: false,
                });
            }
        },

        create: async (block) => {
            set({ loading: true, error: null });
            try {
                const id = uuidv4();
                const newBlock: RecurringBlock = { ...block, id };
                await db.recurringBlocks.add(newBlock);
                set((state) => ({
                    blocks: [...state.blocks, newBlock],
                    loading: false,
                }));
                return id;
            } catch (err) {
                set({
                    error: err instanceof Error ? err.message : "Failed to create recurring block",
                    loading: false,
                });
                throw err;
            }
        },

        update: async (id, changes) => {
            set({ error: null });
            try {
                await db.recurringBlocks.update(id, changes);
                set((state) => ({
                    blocks: state.blocks.map((b) => (b.id === id ? { ...b, ...changes } : b)),
                }));
            } catch (err) {
                set({ error: err instanceof Error ? err.message : "Failed to update recurring block" });
            }
        },

        delete: async (id) => {
            set({ error: null });
            try {
                await db.recurringBlocks.delete(id);
                set((state) => ({
                    blocks: state.blocks.filter((b) => b.id !== id),
                }));
            } catch (err) {
                set({ error: err instanceof Error ? err.message : "Failed to delete recurring block" });
            }
        },

        clearError: () => set({ error: null }),
    })
);
