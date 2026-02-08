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
}));

vi.mock("./syncStore", () => ({
    useSyncStore: {
        getState: () => ({
            calendarId: "",
            refreshPendingCount: mockRefreshPendingCount,
        }),
    },
}));

import { useAppointmentStore } from "./appointmentStore";

const inputAppointment: Omit<Appointment, "id" | "createdAt" | "updatedAt"> = {
    patientId: "patient-1",
    date: "2026-02-08",
    startTime: "09:00",
    duration: 60,
    status: "scheduled",
    syncStatus: "local",
    notes: "Test appointment",
};

describe("useAppointmentStore.create", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
