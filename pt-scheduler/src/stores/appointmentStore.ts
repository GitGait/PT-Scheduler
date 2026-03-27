import { create } from "zustand";
import type { Appointment, AppointmentStatus } from "../types";
import { appointmentDB, syncQueueDB, trackDeletedAppointmentId, clearDeletedAppointmentId } from "../db/operations";
import { useSyncStore } from "./syncStore";
import { deleteCalendarEvent } from "../api/calendar";
import { isSignedIn } from "../api/auth";
import { db } from "../db/schema";

// IDs of appointments currently being deleted — prevents loadByRange from
// resurrecting them before the DB write completes.
const deletingIds = new Set<string>();

// IDs of appointments currently being updated — prevents loadByRange from
// overwriting optimistic state with stale DB data (especially when calendar
// sync is not configured and syncStatus stays "synced").
const mutatingIds = new Set<string>();

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
            const allInRange = await appointmentDB.byRange(startDate, endDate);
            // On-hold appointments live exclusively in onHoldAppointments
            const dbAppts = allInRange.filter((a) => a.status !== "on-hold");

            // Merge instead of full-replace: preserve optimistic updates
            // for pending/local/mutating appointments and skip in-flight deletes.
            const currentAppts = get().appointments;
            const preserveById = new Map<string, Appointment>();
            for (const a of currentAppts) {
                if (a.syncStatus === "pending" || a.syncStatus === "local" || mutatingIds.has(a.id)) {
                    preserveById.set(a.id, a);
                }
            }

            const merged: Appointment[] = [];
            const seenIds = new Set<string>();

            for (const dbAppt of dbAppts) {
                // Skip appointments being deleted right now
                if (deletingIds.has(dbAppt.id)) continue;

                seenIds.add(dbAppt.id);

                // Keep the optimistic version for pending/local/mutating appointments
                const preserved = preserveById.get(dbAppt.id);
                if (preserved) {
                    merged.push(preserved);
                } else {
                    merged.push(dbAppt);
                }
            }

            // Preserve pending/local/mutating appointments from state that aren't
            // in DB results (e.g., cross-week drags where the new date is outside range)
            for (const [id, appt] of preserveById) {
                if (!seenIds.has(id) && !deletingIds.has(id)) {
                    merged.push(appt);
                }
            }

            set({ appointments: merged, loading: false });
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
        mutatingIds.add(id);
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
        } finally {
            // Delay cleanup so loadByRange preserves optimistic state through
            // any sync-triggered reloads that fire shortly after the update.
            setTimeout(() => mutatingIds.delete(id), 3000);
        }
    },

    delete: async (id) => {
        set({ error: null });
        // Mark as deleting so loadByRange won't resurrect from DB
        deletingIds.add(id);
        // Track in localStorage so sync pull won't re-import from Google Calendar
        trackDeletedAppointmentId(id);
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
                    // Calendar delete succeeded — no need to keep tracking
                    clearDeletedAppointmentId(id);
                } catch (calErr) {
                    // If calendar delete fails, queue it for retry
                    // Keep the deleted tracking so sync won't re-import
                    console.warn("Immediate calendar delete failed, queuing for retry:", calErr);
                    await enqueueAppointmentSync("delete", id, eventId);
                }
            } else if (calendarId && eventId) {
                // Not signed in, queue for later
                await enqueueAppointmentSync("delete", id, eventId);
            }
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Failed to delete appointment" });
        } finally {
            // Delay cleanup so loadByRange skips this ID through any
            // sync-triggered reloads that fire shortly after the delete.
            setTimeout(() => deletingIds.delete(id), 3000);
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
        // Capture appointment BEFORE async update which may filter it from state
        const appointmentBefore = get().appointments.find((a) => a.id === id);
        const { update } = get();
        await update(id, { status: "on-hold" as AppointmentStatus });
        // Move from appointments to onHoldAppointments
        const appointment = appointmentBefore ?? get().appointments.find((a) => a.id === id);
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
        const restored: Appointment = { ...held, status: "scheduled" as AppointmentStatus, updatedAt: new Date() };
        // Add to appointments and remove from onHoldAppointments in one atomic set
        // (can't use store's update() because it maps over appointments where this item doesn't exist)
        set((state) => ({
            appointments: [...state.appointments, restored],
            onHoldAppointments: state.onHoldAppointments.filter((a) => a.id !== id),
        }));
        // Persist to DB and enqueue sync
        const shouldSync = hasCalendarSyncConfigured();
        await appointmentDB.update(id, {
            status: "scheduled",
            ...(shouldSync ? { syncStatus: "pending" as const } : {}),
        });
        await enqueueAppointmentSync("update", id);
        return restored;
    },

    markComplete: async (id: string) => {
        const { update } = get();
        await update(id, { status: "completed" as AppointmentStatus });
    },

    clearError: () => set({ error: null }),
}));
