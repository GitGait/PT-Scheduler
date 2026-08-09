import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment } from "../types";

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockQueueAdd = vi.fn();
const mockRefreshPendingCount = vi.fn();

vi.mock("../db/operations", () => ({
    appointmentDB: {
        create: (appt: unknown) => mockCreate(appt),
        get: (id: string) => mockGet(id),
        byDate: vi.fn(),
        byRange: vi.fn(),
        byPatient: vi.fn(),
        update: (id: string, changes: unknown) => mockUpdate(id, changes),
        delete: vi.fn(),
        markSynced: vi.fn(),
    },
    syncQueueDB: {
        add: (item: unknown) => mockQueueAdd(item),
    },
    // The store imports both of these on the delete path; omitting them made
    // any delete-path test blow up on an undefined call.
    trackDeletedAppointmentId: vi.fn(),
    clearDeletedAppointmentId: vi.fn(),
}));

vi.mock("../db/schema", () => ({
    db: {
        calendarEvents: {
            where: () => ({ equals: () => ({ delete: vi.fn().mockResolvedValue(0) }) }),
            delete: vi.fn(),
        },
    },
}));

vi.mock("../api/calendar", () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock("../api/auth", () => ({ isSignedIn: vi.fn(() => false) }));

vi.mock("./syncStore", () => ({
    useSyncStore: {
        getState: () => ({
            calendarId: "",
            refreshPendingCount: mockRefreshPendingCount,
        }),
    },
}));

import { useAppointmentStore } from "./appointmentStore";
import { useUndoStore, __resetUndoModuleState, type UndoUpdateEntry, type UndoHoldEntry, type UndoDeleteEntry } from "./undoStore";

const inputAppointment: Omit<Appointment, "id" | "createdAt" | "updatedAt"> = {
    patientId: "patient-1",
    date: "2026-02-08",
    startTime: "09:00",
    duration: 60,
    status: "scheduled",
    syncStatus: "local",
    notes: "Test appointment",
    visitType: null,
};

describe("useAppointmentStore.create", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
        mockQueueAdd.mockResolvedValue(1);
        mockRefreshPendingCount.mockResolvedValue(undefined);
        useAppointmentStore.setState({
            appointments: [],
            selectedDate: "2026-02-08",
            loading: false,
            error: null,
        });
    });

    it("clears loading and stores fallback appointment when DB read misses", async () => {
        mockCreate.mockResolvedValue("appt-1");
        mockGet.mockResolvedValue(undefined);

        const id = await useAppointmentStore.getState().create(inputAppointment);
        const state = useAppointmentStore.getState();

        expect(id).toBe("appt-1");
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
        expect(state.appointments).toHaveLength(1);
        expect(state.appointments[0]).toMatchObject({
            id: "appt-1",
            ...inputAppointment,
        });
    });

    it("clears loading and sets error when create fails", async () => {
        mockCreate.mockRejectedValue(new Error("Create failed"));

        await expect(useAppointmentStore.getState().create(inputAppointment)).rejects.toThrow(
            "Create failed"
        );

        const state = useAppointmentStore.getState();
        expect(state.loading).toBe(false);
        expect(state.error).toBe("Create failed");
    });
});

describe("useAppointmentStore.update", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
        mockQueueAdd.mockResolvedValue(1);
        mockRefreshPendingCount.mockResolvedValue(undefined);
        useAppointmentStore.setState({
            appointments: [
                {
                    id: "appt-1",
                    patientId: "patient-1",
                    date: "2026-02-08",
                    startTime: "09:00",
                    duration: 60,
                    status: "scheduled",
                    syncStatus: "local",
                    notes: "Initial",
                    visitType: null,
                    createdAt: new Date("2026-02-08T00:00:00.000Z"),
                    updatedAt: new Date("2026-02-08T00:00:00.000Z"),
                },
            ],
            selectedDate: "2026-02-08",
            loading: false,
            error: null,
        });
    });

    it("updates state immediately before DB update resolves", async () => {
        let resolveUpdate: (() => void) | undefined;
        const pendingUpdate = new Promise<void>((resolve) => {
            resolveUpdate = resolve;
        });
        mockUpdate.mockReturnValue(pendingUpdate);

        const updatePromise = useAppointmentStore
            .getState()
            .update("appt-1", { startTime: "10:00", date: "2026-02-09" });

        const stateAfterCall = useAppointmentStore.getState();
        expect(stateAfterCall.appointments[0].startTime).toBe("10:00");
        expect(stateAfterCall.appointments[0].date).toBe("2026-02-09");

        resolveUpdate?.();
        await updatePromise;
    });

    it("rolls back optimistic update when DB update fails", async () => {
        mockUpdate.mockRejectedValue(new Error("Update failed"));

        await useAppointmentStore.getState().update("appt-1", { startTime: "10:00" });

        const state = useAppointmentStore.getState();
        expect(state.appointments[0].startTime).toBe("09:00");
        expect(state.error).toBe("Update failed");
    });
});

describe("undo recording", () => {
    const seeded = {
        id: "appt-1",
        patientId: "patient-1",
        date: "2026-02-08",
        startTime: "09:00",
        duration: 60,
        status: "scheduled" as const,
        syncStatus: "local" as const,
        notes: "Initial",
        visitType: null,
        createdAt: new Date("2026-02-08T00:00:00.000Z"),
        updatedAt: new Date("2026-02-08T00:00:00.000Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
        mockQueueAdd.mockResolvedValue(1);
        mockRefreshPendingCount.mockResolvedValue(undefined);
        mockUpdate.mockResolvedValue(undefined);
        useAppointmentStore.setState({
            appointments: [seeded],
            onHoldAppointments: [],
            selectedDate: "2026-02-08",
            loading: false,
            error: null,
        });
    });

    it("records a move with only the changed keys", async () => {
        await useAppointmentStore.getState().update("appt-1", { startTime: "10:00" });

        const entries = useUndoStore.getState().entries;
        expect(entries).toHaveLength(1);

        const entry = entries[0] as UndoUpdateEntry;
        expect(entry.kind).toBe("update");
        expect(entry.reason).toBe("move");
        expect(entry.appointmentId).toBe("appt-1");
        expect(entry.before).toEqual({ startTime: "09:00" });
        expect(entry.after).toEqual({ startTime: "10:00" });
        expect(entry.label).toBe("Appointment moved");
    });

    it("records nothing for a no-op patch", async () => {
        await useAppointmentStore.getState().update("appt-1", { startTime: "09:00", duration: 60 });

        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("records nothing when record: false", async () => {
        await useAppointmentStore.getState().update("appt-1", { startTime: "11:00" }, { record: false });

        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("records nothing when the appointment is not in state", async () => {
        await useAppointmentStore.getState().update("ghost", { startTime: "11:00" });

        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("records a create with the returned id", async () => {
        mockCreate.mockResolvedValue("appt-new");
        mockGet.mockResolvedValue(undefined);

        await useAppointmentStore.getState().create(inputAppointment);

        const entries = useUndoStore.getState().entries;
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: "create", appointmentId: "appt-new", label: "Appointment added" });
    });

    it("records a delete snapshot without id/timestamps/calendarEventId", async () => {
        mockGet.mockResolvedValue({ ...seeded, calendarEventId: "gcal-1" });

        await useAppointmentStore.getState().delete("appt-1");

        const entries = useUndoStore.getState().entries;
        expect(entries).toHaveLength(1);

        const entry = entries[0] as UndoDeleteEntry;
        expect(entry.kind).toBe("delete");
        expect(entry.appointmentId).toBe("appt-1");
        expect(entry.calendarEventId).toBe("gcal-1");
        expect(entry.snapshot).not.toHaveProperty("id");
        expect(entry.snapshot).not.toHaveProperty("createdAt");
        expect(entry.snapshot).not.toHaveProperty("updatedAt");
        expect(entry.snapshot).not.toHaveProperty("calendarEventId");
        expect(entry.snapshot).toMatchObject({ patientId: "patient-1", startTime: "09:00", duration: 60 });
    });

    it("records exactly one hold entry, not a hold plus an update", async () => {
        await useAppointmentStore.getState().putOnHold("appt-1");

        const entries = useUndoStore.getState().entries;
        expect(entries).toHaveLength(1);

        const entry = entries[0] as UndoHoldEntry;
        expect(entry.kind).toBe("hold");
        expect(entry.previousStatus).toBe("scheduled");
        expect(entry.label).toBe("Moved to On Hold");
    });
});
