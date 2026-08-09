import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/calendar", () => ({
    deleteCalendarEvent: vi.fn(),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
}));
vi.mock("../api/auth", () => ({ isSignedIn: vi.fn(() => false) }));

const mockSyncState = { calendarId: "", refreshPendingCount: vi.fn().mockResolvedValue(undefined) };
vi.mock("./syncStore", () => ({
    useSyncStore: { getState: () => mockSyncState },
}));

vi.mock("../utils/mutationCooldown", async (importOriginal) => {
    const real = await importOriginal<typeof import("../utils/mutationCooldown")>();
    return { ...real, markLocalMutation: vi.fn(real.markLocalMutation) };
});

import { db } from "../db/schema";
import { appointmentDB, getDeletedAppointmentIds } from "../db/operations";
import { deleteCalendarEvent } from "../api/calendar";
import { isSignedIn } from "../api/auth";
import { markLocalMutation } from "../utils/mutationCooldown";
import { useAppointmentStore } from "./appointmentStore";
import { applyNextUndo, computeRevertPatch } from "./undoApply";
import {
    useUndoStore,
    recordUndo,
    beginUndoBatch,
    endUndoBatch,
    __resetUndoModuleState,
    type UndoDeleteEntry,
} from "./undoStore";
import type { Appointment } from "../types";

const baseAppointment = {
    patientId: "patient-1",
    date: "2026-08-10",
    startTime: "09:00",
    duration: 60,
    status: "scheduled" as const,
    syncStatus: "local" as const,
    visitType: null,
    chipNotes: ["Gate 4"],
};

async function seedAppointment(overrides: Partial<Appointment> = {}): Promise<string> {
    const id = await appointmentDB.create({ ...baseAppointment, ...overrides });
    const created = await appointmentDB.get(id);
    useAppointmentStore.setState((s) => ({ appointments: [...s.appointments, created as Appointment] }));
    return id;
}

function currentAppointments(): Appointment[] {
    return useAppointmentStore.getState().appointments;
}

describe("computeRevertPatch", () => {
    it("reverts keys nobody else touched", () => {
        const patch = computeRevertPatch(
            { startTime: "10:00", duration: 60 },
            { startTime: "09:00" },
            { startTime: "10:00" }
        );
        expect(patch).toEqual({ startTime: "09:00" });
    });

    it("skips a key changed by someone else since recording", () => {
        const patch = computeRevertPatch(
            { startTime: "13:00" },
            { startTime: "09:00" },
            { startTime: "10:00" }
        );
        expect(patch).toEqual({});
    });

    it("compares arrays by value, not identity", () => {
        const patch = computeRevertPatch(
            { chipNotes: ["a", "b"] },
            { chipNotes: ["a"] },
            { chipNotes: ["a", "b"] }
        );
        expect(patch).toEqual({ chipNotes: ["a"] });
    });
});

describe("applyNextUndo", () => {
    beforeEach(async () => {
        await db.appointments.clear();
        await db.calendarEvents.clear();
        await db.syncQueue.clear();
        localStorage.clear();
        vi.clearAllMocks();
        mockSyncState.calendarId = "";
        vi.mocked(isSignedIn).mockReturnValue(false);
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
        useAppointmentStore.setState({
            appointments: [],
            onHoldAppointments: [],
            selectedDate: "2026-08-10",
            loading: false,
            error: null,
        });
    });

    it("returns empty for an empty stack", async () => {
        await expect(applyNextUndo()).resolves.toEqual({ status: "empty" });
    });

    it("restores exactly the recorded keys, leaving an unrelated field alone", async () => {
        const id = await seedAppointment();

        await useAppointmentStore.getState().update(id, { startTime: "11:00" });
        // Something else writes a different field afterwards.
        await useAppointmentStore.getState().update(id, { visitType: "PT01" }, { record: false });

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Appointment moved" });
        const appt = currentAppointments().find((a) => a.id === id);
        expect(appt?.startTime).toBe("09:00");
        expect(appt?.visitType).toBe("PT01");
    });

    it("skips a key someone else changed, then drops the entry and applies the next", async () => {
        const id = await seedAppointment();

        // Entry 1 (older): a duration change we will fall back to.
        await useAppointmentStore.getState().update(id, { duration: 45 });
        // Entry 2 (newer): a move that gets clobbered before undo runs.
        await useAppointmentStore.getState().update(id, { startTime: "11:00" });
        await useAppointmentStore.getState().update(id, { startTime: "15:00" }, { record: false });

        expect(useUndoStore.getState().entries).toHaveLength(2);

        const result = await applyNextUndo();

        // The move entry was unrevertable, so the duration entry applied instead.
        expect(result).toEqual({ status: "applied", label: "Duration changed" });
        const appt = currentAppointments().find((a) => a.id === id);
        expect(appt?.startTime).toBe("15:00");
        expect(appt?.duration).toBe(60);
        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("undoes a create by deleting the appointment", async () => {
        const id = await useAppointmentStore.getState().create(baseAppointment);
        expect(currentAppointments()).toHaveLength(1);

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Appointment added" });
        expect(currentAppointments()).toHaveLength(0);
        expect(await appointmentDB.get(id)).toBeUndefined();
    });

    it("undoes a delete by re-creating with a new id and no calendarEventId", async () => {
        const id = await seedAppointment({ calendarEventId: "gcal-1" } as Partial<Appointment>);

        await useAppointmentStore.getState().delete(id);
        expect(currentAppointments()).toHaveLength(0);

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Appointment deleted" });
        const restored = currentAppointments();
        expect(restored).toHaveLength(1);
        expect(restored[0].id).not.toBe(id);
        expect(restored[0].calendarEventId).toBeUndefined();
        expect(restored[0].syncStatus).toBe("local");
        expect(restored[0]).toMatchObject({
            patientId: "patient-1",
            date: "2026-08-10",
            startTime: "09:00",
            duration: 60,
            visitType: null,
            chipNotes: ["Gate 4"],
        });
    });

    it("remaps ids: update A, delete A, undo, undo again lands on A's old slot", async () => {
        const id = await seedAppointment();

        await useAppointmentStore.getState().update(id, { startTime: "14:00" });
        await useAppointmentStore.getState().delete(id);

        // First undo re-creates under a fresh uuid.
        await applyNextUndo();
        const recreated = currentAppointments()[0];
        expect(recreated.id).not.toBe(id);
        expect(recreated.startTime).toBe("14:00");

        // Second undo targets the destroyed uuid and must follow the remap.
        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Appointment moved" });
        const after = currentAppointments()[0];
        expect(after.id).toBe(recreated.id);
        expect(after.startTime).toBe("09:00");
    });

    it("keeps the tombstone when the Google delete failed, leaving exactly one chip", async () => {
        mockSyncState.calendarId = "cal-1";
        vi.mocked(isSignedIn).mockReturnValue(true);
        vi.mocked(deleteCalendarEvent).mockRejectedValue(new Error("network"));

        const id = await seedAppointment({ calendarEventId: "gcal-1" } as Partial<Appointment>);

        await useAppointmentStore.getState().delete(id);
        expect(getDeletedAppointmentIds().has(id)).toBe(true);

        await applyNextUndo();

        // The tombstone on the OLD id must survive: the Google event may still
        // exist upstream, and clearing it would let a pull re-import a ghost.
        expect(getDeletedAppointmentIds().has(id)).toBe(true);
        const restored = currentAppointments();
        expect(restored).toHaveLength(1);
        expect(getDeletedAppointmentIds().has(restored[0].id)).toBe(false);
    });

    it("undoes a hold by returning the appointment with its previous status", async () => {
        const id = await seedAppointment();

        await useAppointmentStore.getState().putOnHold(id);
        expect(useAppointmentStore.getState().onHoldAppointments).toHaveLength(1);
        expect(currentAppointments()).toHaveLength(0);

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Moved to On Hold" });
        expect(useAppointmentStore.getState().onHoldAppointments).toHaveLength(0);
        expect(currentAppointments()).toHaveLength(1);
        expect(currentAppointments()[0].status).toBe("scheduled");
    });

    it("undoes a clear-week batch, re-creating all N with new ids", async () => {
        const ids = [
            await seedAppointment({ startTime: "09:00" }),
            await seedAppointment({ startTime: "10:00" }),
            await seedAppointment({ startTime: "11:00" }),
        ];

        beginUndoBatch("clear-week", "Cleared 3 appointments");
        for (const id of ids) {
            await useAppointmentStore.getState().delete(id);
        }
        endUndoBatch();

        expect(currentAppointments()).toHaveLength(0);
        expect(useUndoStore.getState().entries).toHaveLength(1);

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Cleared 3 appointments" });
        const restored = currentAppointments();
        expect(restored).toHaveLength(3);
        expect(restored.map((a) => a.startTime).sort()).toEqual(["09:00", "10:00", "11:00"]);
        for (const a of restored) {
            expect(ids).not.toContain(a.id);
            expect(a.syncStatus).toBe("local");
        }
        // Applying an undo must not grow the stack.
        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("undoes an auto-arrange batch, restoring every original startTime", async () => {
        const a = await seedAppointment({ startTime: "09:00" });
        const b = await seedAppointment({ startTime: "10:00" });

        beginUndoBatch("auto-arrange", "Day auto-arranged");
        await useAppointmentStore.getState().update(a, { startTime: "13:00" });
        await useAppointmentStore.getState().update(b, { startTime: "14:00" });
        endUndoBatch();

        await applyNextUndo();

        const byId = new Map(currentAppointments().map((x) => [x.id, x.startTime]));
        expect(byId.get(a)).toBe("09:00");
        expect(byId.get(b)).toBe("10:00");
    });

    it("drops a stale entry whose row is gone and applies the next instead", async () => {
        const keep = await seedAppointment({ startTime: "09:00" });
        const doomed = await seedAppointment({ startTime: "16:00" });

        await useAppointmentStore.getState().update(keep, { duration: 30 });
        await useAppointmentStore.getState().update(doomed, { startTime: "17:00" });

        // Vanish the row from both Dexie and store state, behind undo's back.
        await db.appointments.delete(doomed);
        useAppointmentStore.setState((s) => ({ appointments: s.appointments.filter((x) => x.id !== doomed) }));

        const result = await applyNextUndo();

        expect(result).toEqual({ status: "applied", label: "Duration changed" });
        expect(currentAppointments().find((x) => x.id === keep)?.duration).toBe(60);
    });

    it("records nothing while applying — the stack only shrinks", async () => {
        const id = await seedAppointment();
        await useAppointmentStore.getState().update(id, { startTime: "11:00" });
        expect(useUndoStore.getState().entries).toHaveLength(1);

        await applyNextUndo();

        expect(useUndoStore.getState().entries).toHaveLength(0);
    });

    it("never applies the same entry twice under concurrent calls", async () => {
        const id = await seedAppointment();
        await useAppointmentStore.getState().update(id, { duration: 30 });
        await useAppointmentStore.getState().update(id, { startTime: "11:00" });

        const [first, second] = await Promise.all([applyNextUndo(), applyNextUndo()]);

        // Two entries, two distinct applications — never the same one twice.
        const labels = [first, second].map((r) => (r.status === "applied" ? r.label : r.status));
        expect(new Set(labels).size).toBe(2);
        expect(useUndoStore.getState().entries).toHaveLength(0);

        const appt = currentAppointments().find((a) => a.id === id);
        expect(appt?.startTime).toBe("09:00");
        expect(appt?.duration).toBe(60);
    });

    it("stamps the mutation cooldown before writing on every apply path", async () => {
        const id = await seedAppointment();
        await useAppointmentStore.getState().update(id, { startTime: "11:00" });
        vi.mocked(markLocalMutation).mockClear();

        await applyNextUndo();
        expect(markLocalMutation).toHaveBeenCalled();

        // delete path
        await useAppointmentStore.getState().delete(id);
        vi.mocked(markLocalMutation).mockClear();
        await applyNextUndo();
        expect(markLocalMutation).toHaveBeenCalled();
    });

    it("still records a user gesture that lands during an in-flight undo", async () => {
        const undone = await seedAppointment({ startTime: "09:00" });
        const other = await seedAppointment({ startTime: "16:00" });

        await useAppointmentStore.getState().update(undone, { startTime: "11:00" });

        // Start the undo, then fire a real gesture before it settles.
        const undoPromise = applyNextUndo();
        await useAppointmentStore.getState().update(other, { startTime: "17:00" });
        await undoPromise;

        // The concurrent gesture must have survived — a global suppression
        // counter held across the applier's awaits would have eaten it.
        const entries = useUndoStore.getState().entries;
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: "update", appointmentId: other });
    });

    it("drops a delete entry's stale siblings but still restores what it can", async () => {
        const id = await seedAppointment();
        await useAppointmentStore.getState().delete(id);

        const entry = useUndoStore.getState().entries[0] as UndoDeleteEntry;
        expect(entry.snapshot).not.toHaveProperty("calendarEventId");

        await applyNextUndo();
        expect(currentAppointments()).toHaveLength(1);
    });

    it("returns empty rather than throwing when every entry is stale", async () => {
        const id = await seedAppointment();
        await useAppointmentStore.getState().update(id, { startTime: "11:00" });

        await db.appointments.delete(id);
        useAppointmentStore.setState({ appointments: [] });

        await expect(applyNextUndo()).resolves.toEqual({ status: "empty" });
    });
});

describe("recordUndo interaction", () => {
    beforeEach(() => {
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
    });

    it("pops newest-first so undo is LIFO", async () => {
        recordUndo({ kind: "create", appointmentId: "a" });
        recordUndo({ kind: "create", appointmentId: "b" });

        expect(useUndoStore.getState().entries.map((e) => e.entryId)).toHaveLength(2);
        const top = useUndoStore.getState().pop();
        expect(top).toMatchObject({ appointmentId: "b" });
    });
});
