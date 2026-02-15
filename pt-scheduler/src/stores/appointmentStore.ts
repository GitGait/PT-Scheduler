import { create } from "zustand";
import type { Appointment, AppointmentStatus } from "../types";
import { appointmentDB, syncQueueDB } from "../db/operations";
import { useSyncStore } from "./syncStore";
import { deleteCalendarEvent } from "../api/calendar";
import { isSignedIn } from "../api/auth";
import { db } from "../db/schema";

interface AppointmentState {
    appointments: Appointment[];
    onHoldAppointments: Appointment[];
    selectedDate: string; // YYYY-MM-DD
    loading: boolean;
    error: string | null;
}

interface AppointmentActions {
    loadByDate: (date: string) => Promise<void>;
    loadByRange: (startDate: string, endDate: string) => Promise<void>;
    loadByPatient: (patientId: string) => Promise<void>;
    loadOnHold: () => Promise<void>;
    setSelectedDate: (date: string) => void;
    create: (appt: Omit<Appointment, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    update: (id: string, changes: Partial<Omit<Appointment, "id" | "createdAt">>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    markComplete: (id: string) => Promise<void>;
    putOnHold: (id: string) => Promise<void>;
    restoreFromHold: (id: string) => Promise<Appointment | undefined>;
    clearError: () => void;
}

// Helper to get today's date as ISO string
const today = () => new Date().toISOString().split("T")[0];

function hasCalendarSyncConfigured(): boolean {
    const calendarId = useSyncStore.getState().calendarId;
    return Boolean(calendarId.trim());
}

async function enqueueAppointmentSync(
    type: "create" | "update" | "delete",
    entityId: string,
    calendarEventId?: string
): Promise<void> {
    if (!hasCalendarSyncConfigured()) {
        return;
    }

    await syncQueueDB.add({
        type,
        entity: "appointment",
        data: {
            entityId,
            ...(calendarEventId ? { calendarEventId } : {}),
        },
    });

    await useSyncStore.getState().refreshPendingCount();
}

export const useAppointmentStore = create<AppointmentState & AppointmentActions>((set, get) => ({
    appointments: [],
    onHoldAppointments: [],
    selectedDate: today(),
    loading: false,
    error: null,

    loadByDate: async (date: string) => {
        set({ loading: true, error: null, selectedDate: date });
        try {
            const appointments = await appointmentDB.byDate(date);
            set({ appointments, loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load appointments",
                loading: false,
            });
        }
    },

    loadByRange: async (startDate: string, endDate: string) => {
        // Only show loading skeleton on initial load (no appointments yet).
        // On refresh/reload, keep existing appointments visible to prevent
        // scroll position reset from DOM swap (skeleton replaces grid).
        const isInitialLoad = get().appointments.length === 0;
        set({ loading: isInitialLoad, error: null });
        try {
            const appointments = await appointmentDB.byRange(startDate, endDate);
            set({ appointments, loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load appointments",
                loading: false,
            });
        }
    },

    loadByPatient: async (patientId: string) => {
        set({ loading: true, error: null });
        try {
            const appointments = await appointmentDB.byPatient(patientId);
            set({ appointments, loading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to load appointments",
                loading: false,
            });
        }
    },

    setSelectedDate: (date: string) => {
        set({ selectedDate: date });
    },

    create: async (appt) => {
        set({ loading: true, error: null });
        try {
            const id = await appointmentDB.create(appt);
            await enqueueAppointmentSync("create", id);

            if (hasCalendarSyncConfigured()) {
                await appointmentDB.update(id, { syncStatus: "pending" });
            }

            const newAppt = await appointmentDB.get(id);
            const appointmentToStore =
                newAppt ??
                ({
                    ...appt,
                    id,
                    syncStatus: hasCalendarSyncConfigured() ? "pending" : appt.syncStatus,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                } as Appointment);

            set((state) => ({
                appointments: [...state.appointments, appointmentToStore],
            }));
            return id;
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : "Failed to create appointment",
            });
            throw err;
        } finally {
            set({ loading: false });
        }
    },

    update: async (id, changes) => {
        set({ error: null });
        const shouldSync = hasCalendarSyncConfigured();
        const previous = get().appointments.find((a) => a.id === id);
        const optimisticUpdatedAt = new Date();
        set((state) => ({
            appointments: state.appointments.map((a) =>
                a.id === id
                    ? {
                          ...a,
                          ...changes,
                          syncStatus: shouldSync ? "pending" : a.syncStatus,
                          updatedAt: optimisticUpdatedAt,
                      }
                    : a
            ),
        }));

        try {
            await appointmentDB.update(id, {
                ...changes,
                ...(shouldSync ? { syncStatus: "pending" as const } : {}),
            });
            await enqueueAppointmentSync("update", id);
        } catch (err) {
            set((state) => ({
                error: err instanceof Error ? err.message : "Failed to update appointment",
                appointments: previous
                    ? state.appointments.map((a) => (a.id === id ? previous : a))
                    : state.appointments,
            }));
        }
    },

    delete: async (id) => {
        set({ error: null });
        try {
            const appointment = await appointmentDB.get(id);

            // Immediately remove from local state to provide instant feedback
            set((state) => ({
                appointments: state.appointments.filter((a) => a.id !== id),
            }));

            // Delete from local database
            await appointmentDB.delete(id);

            // Delete calendar event mapping
            await db.calendarEvents.where("appointmentId").equals(id).delete();

            // Immediately delete from Google Calendar if signed in (don't just queue it)
            const calendarId = useSyncStore.getState().calendarId;
            const eventId = appointment?.calendarEventId;

            if (calendarId && eventId && isSignedIn()) {
                try {
                    await deleteCalendarEvent(calendarId, eventId);
                    await db.calendarEvents.delete(eventId);
                } catch (calErr) {
                    // If calendar delete fails, queue it for retry
                    console.warn("Immediate calendar delete failed, queuing for retry:", calErr);
                    await enqueueAppointmentSync("delete", id, eventId);
                }
            } else if (calendarId && eventId) {
                // Not signed in, queue for later
                await enqueueAppointmentSync("delete", id, eventId);
            }
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to delete appointment" });
        }
    },

    loadOnHold: async () => {
        try {
            const held = await appointmentDB.byStatus("on-hold");
            set({ onHoldAppointments: held });
        } catch (err) {
            console.error("Failed to load on-hold appointments:", err);
        }
    },

    putOnHold: async (id: string) => {
        const { update } = get();
        await update(id, { status: "on-hold" as AppointmentStatus });
        // Move from appointments to onHoldAppointments
        const appointment = get().appointments.find((a) => a.id === id);
        if (appointment) {
            set((state) => ({
                appointments: state.appointments.filter((a) => a.id !== id),
                onHoldAppointments: [...state.onHoldAppointments, { ...appointment, status: "on-hold" as AppointmentStatus }],
            }));
        }
    },

    restoreFromHold: async (id: string) => {
        const held = get().onHoldAppointments.find((a) => a.id === id);
        if (!held) return undefined;
        await get().update(id, { status: "scheduled" as AppointmentStatus });
        set((state) => ({
            onHoldAppointments: state.onHoldAppointments.filter((a) => a.id !== id),
        }));
        return { ...held, status: "scheduled" as AppointmentStatus };
    },

    markComplete: async (id: string) => {
        const { update } = get();
        await update(id, { status: "completed" as AppointmentStatus });
    },

    clearError: () => set({ error: null }),
}));
