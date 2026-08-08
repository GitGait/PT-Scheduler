import { create } from "zustand";
import type { SyncAction, VisitTypeDef } from "../types";
import { BUILT_IN_VISIT_TYPE_CODES } from "../types";
import { visitTypeDB, syncQueueDB } from "../db/operations";
import { useSyncStore } from "./syncStore";
import {
    BUILT_IN_VISIT_TYPE_CONFIGS,
    deriveGradient,
    setVisitTypeRegistry,
    type VisitTypeConfig,
} from "../utils/visitTypeColors";
import { isValidVisitTypeColor, VISIT_TYPE_CODE_REGEX } from "../utils/visitTypeCodes";

const BUILT_IN_CODE_SET = new Set<string>(BUILT_IN_VISIT_TYPE_CODES);

export function isBuiltInVisitTypeCode(code: string): boolean {
    return BUILT_IN_CODE_SET.has(code);
}

/**
 * Merge the frozen built-ins with the stored rows. A stored row for a built-in
 * code is an override; any other stored row is a user-created type. Built-ins
 * are never seeded into Dexie, so they cannot be removed by any code path.
 */
export function mergeVisitTypes(stored: readonly VisitTypeDef[]): VisitTypeConfig[] {
    const overrides = new Map<string, VisitTypeDef>();
    const customs: VisitTypeDef[] = [];

    for (const def of stored) {
        if (!def?.code || !VISIT_TYPE_CODE_REGEX.test(def.code)) continue;
        if (isBuiltInVisitTypeCode(def.code)) {
            overrides.set(def.code, def);
        } else {
            customs.push(def);
        }
    }

    const fromBuiltIn = BUILT_IN_VISIT_TYPE_CONFIGS.map((builtIn) => {
        const override = overrides.get(builtIn.code as string);
        if (!override) return builtIn;
        return toConfig(override, builtIn);
    });

    customs.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

    return [...fromBuiltIn, ...customs.map((def) => toConfig(def))];
}

/**
 * A built-in whose colour is untouched keeps its hand-picked gradient pair;
 * anything else derives one from `bg`.
 */
function toConfig(def: VisitTypeDef, builtIn?: VisitTypeConfig): VisitTypeConfig {
    const bg = isValidVisitTypeColor(def.bg) ? def.bg.toLowerCase() : builtIn?.bg ?? "#b0bec5";
    const gradient =
        builtIn && bg === builtIn.bg.toLowerCase() ? builtIn.gradient : deriveGradient(bg);
    return { code: def.code, label: def.label, bg, gradient, hidden: def.hidden === true };
}

function hasSheetsSyncConfigured(): boolean {
    const spreadsheetId = useSyncStore.getState().spreadsheetId;
    return Boolean(spreadsheetId.trim());
}

export async function enqueueVisitTypeSync(type: SyncAction, entityId: string): Promise<void> {
    if (!hasSheetsSyncConfigured()) return;
    await syncQueueDB.add({
        type,
        entity: "visitType",
        data: { entityId },
    });
    await useSyncStore.getState().refreshPendingCount();
}

interface VisitTypeState {
    /** Stored overrides and custom types only — not the effective list. */
    stored: VisitTypeDef[];
    /** The effective list: built-ins with overrides applied, then customs. */
    configs: VisitTypeConfig[];
    loading: boolean;
    error: string | null;
}

interface VisitTypeActions {
    loadAll: () => Promise<void>;
    /** Create or update a stored row (an override for a built-in, or a custom type). */
    save: (
        input: Pick<VisitTypeDef, "code" | "label" | "bg"> & Partial<Pick<VisitTypeDef, "hidden" | "sortOrder">>
    ) => Promise<void>;
    setHidden: (code: string, hidden: boolean) => Promise<void>;
    /** Remove the stored row. For a built-in this is "reset to default". */
    remove: (code: string) => Promise<void>;
    clearError: () => void;
}

function applyRegistry(stored: VisitTypeDef[]): VisitTypeConfig[] {
    const configs = mergeVisitTypes(stored);
    setVisitTypeRegistry(configs);
    return configs;
}

export const useVisitTypeStore = create<VisitTypeState & VisitTypeActions>((set, get) => ({
    stored: [],
    configs: [...BUILT_IN_VISIT_TYPE_CONFIGS],
    loading: false,
    error: null,

    loadAll: async () => {
        set({ error: null });
        try {
            const stored = await visitTypeDB.all();
            set({ stored, configs: applyRegistry(stored), loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load visit types",
                loading: false,
            });
        }
    },

    save: async (input) => {
        set({ error: null });
        const existing = get().stored.find((d) => d.code === input.code);
        const now = new Date();
        const def: VisitTypeDef = {
            code: input.code,
            label: input.label,
            bg: input.bg.toLowerCase(),
            hidden: input.hidden ?? existing?.hidden ?? false,
            sortOrder: input.sortOrder ?? existing?.sortOrder ?? nextSortOrder(get().stored),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        const stored = upsert(get().stored, def);
        set({ stored, configs: applyRegistry(stored) });

        try {
            await visitTypeDB.put(def);
            await enqueueVisitTypeSync(existing ? "update" : "create", def.code);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to save visit type" });
        }
    },

    setHidden: async (code, hidden) => {
        const existing = get().stored.find((d) => d.code === code);
        const builtIn = BUILT_IN_VISIT_TYPE_CONFIGS.find((c) => c.code === code);
        if (!existing && !builtIn) return;
        await get().save({
            code,
            label: existing?.label ?? builtIn?.label ?? code,
            bg: existing?.bg ?? builtIn?.bg ?? "#b0bec5",
            hidden,
        });
    },

    remove: async (code) => {
        set({ error: null });
        const stored = get().stored.filter((d) => d.code !== code);
        set({ stored, configs: applyRegistry(stored) });

        try {
            await visitTypeDB.delete(code);
            await enqueueVisitTypeSync("delete", code);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to delete visit type" });
        }
    },

    clearError: () => set({ error: null }),
}));

function upsert(stored: VisitTypeDef[], def: VisitTypeDef): VisitTypeDef[] {
    const index = stored.findIndex((d) => d.code === def.code);
    if (index === -1) return [...stored, def];
    const next = [...stored];
    next[index] = def;
    return next;
}

function nextSortOrder(stored: readonly VisitTypeDef[]): number {
    return stored.reduce((max, def) => Math.max(max, def.sortOrder ?? 0), 0) + 1;
}
