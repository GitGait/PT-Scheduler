import { create } from "zustand";

const toIsoDate = (date: Date): string => date.toISOString().split("T")[0];
const defaultDate = (): string => {
    const today = new Date();
    // If Sunday, default to next Monday
    if (today.getDay() === 0) {
        today.setDate(today.getDate() + 1);
    }
    return toIsoDate(today);
};

const ENABLED_CALENDARS_KEY = "ptScheduler.enabledCalendars";

// Check if we're on a mobile device (< 768px width)
const isMobileDevice = (): boolean => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
};

export interface GoogleCalendarInfo {
    id: string;
    summary: string;
    backgroundColor?: string;
    primary?: boolean;
}

export interface ExternalCalendarEvent {
    id: string;
    calendarId: string;
    summary: string;
    startDateTime: string;
    endDateTime: string;
    location?: string;
    backgroundColor?: string;
}

function loadEnabledCalendars(): Record<string, boolean> {
    if (typeof window === "undefined") return {};
    try {
        const stored = localStorage.getItem(ENABLED_CALENDARS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

function saveEnabledCalendars(enabled: Record<string, boolean>): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(ENABLED_CALENDARS_KEY, JSON.stringify(enabled));
}

interface ScheduleState {
    selectedDate: string; // ISO date string YYYY-MM-DD
    sidebarOpen: boolean;
    googleCalendars: GoogleCalendarInfo[];
    enabledCalendars: Record<string, boolean>; // calendarId -> enabled
    externalEvents: ExternalCalendarEvent[];
    loadingCalendars: boolean;
}

interface ScheduleActions {
    setSelectedDate: (date: string | Date) => void;
    setSidebarOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    setGoogleCalendars: (calendars: GoogleCalendarInfo[]) => void;
    toggleCalendar: (calendarId: string) => void;
    setExternalEvents: (events: ExternalCalendarEvent[]) => void;
    setLoadingCalendars: (loading: boolean) => void;
}

export const useScheduleStore = create<ScheduleState & ScheduleActions>((set, get) => ({
    selectedDate: defaultDate(),
    sidebarOpen: !isMobileDevice(), // Start closed on mobile
    googleCalendars: [],
    enabledCalendars: loadEnabledCalendars(),
    externalEvents: [],
    loadingCalendars: false,

    setSelectedDate: (date) => {
        const isoDate = typeof date === "string" ? date : toIsoDate(date);
        set({ selectedDate: isoDate });
    },

    setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
    },

    toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
    },

    setGoogleCalendars: (calendars) => {
        // Initialize any new calendars as enabled by default
        const current = get().enabledCalendars;
        const updated = { ...current };
        for (const cal of calendars) {
            if (!(cal.id in updated)) {
                updated[cal.id] = true;
            }
        }
        saveEnabledCalendars(updated);
        set({ googleCalendars: calendars, enabledCalendars: updated });
    },

    toggleCalendar: (calendarId) => {
        const current = get().enabledCalendars;
        // If undefined or true, it's currently enabled; only false means disabled
        const isCurrentlyEnabled = current[calendarId] !== false;
        const updated = { ...current, [calendarId]: !isCurrentlyEnabled };
        saveEnabledCalendars(updated);
        set({ enabledCalendars: updated });
    },

    setExternalEvents: (events) => {
        set({ externalEvents: events });
    },

    setLoadingCalendars: (loading) => {
        set({ loadingCalendars: loading });
    },
}));
