import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { CalendarEvent } from "../types";
import { db } from "../db/schema";

interface CalendarEventState {
    events: CalendarEvent[];
    loading: boolean;
    error: string | null;
}

interface CalendarEventActions {
    loadByAppointment: (appointmentId: string) => Promise<void>;
    create: (event: Omit<CalendarEvent, "id">) => Promise<string>;
    update: (id: string, changes: Partial<Omit<CalendarEvent, "id">>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    clearError: () => void;
}

export const useCalendarEventStore = create<CalendarEventState & CalendarEventActions>(
    (set) => ({
        events: [],
        loading: false,
        error: null,

        loadByAppointment: async (appointmentId: string) => {
            set({ loading: true, error: null });
            try {
                const events = await db.calendarEvents
                    .where("appointmentId")
                    .equals(appointmentId)
                    .toArray();
                set({ events, loading: false });
            } catch (err) {
                set({
                    error: err instanceof Error ? err.message : "Failed to load calendar events",
                    loading: false,
                });
            }
        },

        create: async (event) => {
            set({ loading: true, error: null });
            try {
                const id = uuidv4();
                const newEvent: CalendarEvent = { ...event, id };
                await db.calendarEvents.add(newEvent);
                set((state) => ({
                    events: [...state.events, newEvent],
                    loading: false,
                }));
                return id;
            } catch (err) {
                set({
                    error: err instanceof Error ? err.message : "Failed to create calendar event",
                    loading: false,
                });
                throw err;
            }
        },

        update: async (id, changes) => {
            set({ error: null });
            try {
                await db.calendarEvents.update(id, changes);
                set((state) => ({
                    events: state.events.map((e) => (e.id === id ? { ...e, ...changes } : e)),
                }));
            } catch (err) {
                set({ error: err instanceof Error ? err.message : "Failed to update calendar event" });
            }
        },

        delete: async (id) => {
            set({ error: null });
            try {
                await db.calendarEvents.delete(id);
                set((state) => ({
                    events: state.events.filter((e) => e.id !== id),
                }));
            } catch (err) {
                set({ error: err instanceof Error ? err.message : "Failed to delete calendar event" });
            }
        },

        clearError: () => set({ error: null }),
    })
);
