import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
}

const THEME_STORAGE_KEY = "pt-scheduler-theme";

// Apply theme to document
function applyTheme(mode: ThemeMode) {
    const root = document.documentElement;

    if (mode === "system") {
        // Remove data-theme to let CSS media query handle it
        root.removeAttribute("data-theme");
    } else {
        // Set explicit theme
        root.setAttribute("data-theme", mode);
    }
}

// Get initial theme from localStorage or default to system
function getInitialTheme(): ThemeMode {
    if (typeof window === "undefined") return "system";

    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.state?.mode) {
                return parsed.state.mode as ThemeMode;
            }
        }
    } catch {
        // Ignore errors
    }
    return "system";
}

// Apply initial theme immediately to prevent flash
if (typeof window !== "undefined") {
    applyTheme(getInitialTheme());
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            mode: "system",
            setMode: (mode) => {
                applyTheme(mode);
                set({ mode });
            },
        }),
        {
            name: THEME_STORAGE_KEY,
            onRehydrateStorage: () => (state) => {
                // Apply theme after rehydration
                if (state?.mode) {
                    applyTheme(state.mode);
                }
            },
        }
    )
);
