import { create } from "zustand";
import { syncQueueDB } from "../db/operations";

const SYNC_CONFIG_STORAGE_KEY = "ptScheduler.syncConfig";

interface StoredSyncConfig {
    spreadsheetId: string;
    calendarId: string;
}

function loadStoredSyncConfig(): StoredSyncConfig {
    if (typeof window === "undefined") {
        return { spreadsheetId: "", calendarId: "" };
    }

    try {
        const raw = window.localStorage.getItem(SYNC_CONFIG_STORAGE_KEY);
        if (!raw) {
            return { spreadsheetId: "", calendarId: "" };
        }

        const parsed = JSON.parse(raw) as Partial<StoredSyncConfig>;
        return {
            spreadsheetId: typeof parsed.spreadsheetId === "string" ? parsed.spreadsheetId : "",
            calendarId: typeof parsed.calendarId === "string" ? parsed.calendarId : "",
        };
    } catch {
        return { spreadsheetId: "", calendarId: "" };
    }
}

function saveStoredSyncConfig(config: StoredSyncConfig): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

interface SyncState {
    isOnline: boolean;
    pendingCount: number;
    spreadsheetId: string;
    calendarId: string;
}

interface SyncActions {
    setOnline: (online: boolean) => void;
    refreshPendingCount: () => Promise<void>;
    setSyncConfig: (config: StoredSyncConfig) => void;
    clearSyncConfig: () => void;
}

const initialSyncConfig = loadStoredSyncConfig();

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    pendingCount: 0,
    spreadsheetId: initialSyncConfig.spreadsheetId,
    calendarId: initialSyncConfig.calendarId,

    setOnline: (online: boolean) => {
        set({ isOnline: online });
    },

    refreshPendingCount: async () => {
        try {
            const count = await syncQueueDB.getPendingCount();
            set({ pendingCount: count });
        } catch {
            // Silently fail - not critical
        }
    },

    setSyncConfig: (config) => {
        const next = {
            spreadsheetId: config.spreadsheetId.trim(),
            calendarId: config.calendarId.trim(),
        };

        saveStoredSyncConfig(next);
        set(next);
    },

    clearSyncConfig: () => {
        const cleared = { spreadsheetId: "", calendarId: "" };
        saveStoredSyncConfig(cleared);
        set(cleared);
    },
}));

// Register online/offline listeners at module scope
if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
        useSyncStore.getState().setOnline(true);
        // Refresh pending count when coming online
        useSyncStore.getState().refreshPendingCount();
    });

    window.addEventListener("offline", () => {
        useSyncStore.getState().setOnline(false);
    });
}
