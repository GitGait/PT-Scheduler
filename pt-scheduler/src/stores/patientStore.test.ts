import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/schema";
import { patientDB } from "../db/operations";

// Mock syncStore with sheets sync OFF but calendar sync ON, so every
// syncQueueDB.add call below is unambiguously the calendar fan-out.
vi.mock("./syncStore", () => ({
    useSyncStore: {
        getState: () => ({
            spreadsheetId: "",
            calendarId: "cal-1",
            refreshPendingCount: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

// Mock syncQueueDB so enqueuePatientSync short-circuits before reaching it.
vi.mock("../db/operations", async (importOriginal) => {
    const real = await importOriginal<typeof import("../db/operations")>();
    return {
        ...real,
        syncQueueDB: {
            add: vi.fn().mockResolvedValue(1),
        },
    };
});

import { usePatientStore } from "./patientStore";
import { syncQueueDB } from "../db/operations";
import type { Appointment } from "../types";

const basePatient = {
    fullName: "Doe, John",
    nicknames: [],
    phoneNumbers: [],
    alternateContacts: [],
    address: "123 Main St",
    status: "active" as const,
    notes: "",
};

describe("usePatientStore.update — lat/lng auto-clear", () => {
    beforeEach(async () => {
        await db.patients.clear();
        vi.clearAllMocks();
        usePatientStore.setState({ patients: [], loading: false, error: null, searchQuery: "" });
    });

    it("clears lat/lng when address changes without explicit coords", async () => {
        // Seed patient with coords
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { address: "456 Oak Ave" });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBeUndefined();
        expect(saved?.lng).toBeUndefined();
        expect(saved?.address).toBe("456 Oak Ave");
    });

    it("does NOT clear coords when updating fields other than address", async () => {
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { notes: "x" });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBe(40);
        expect(saved?.lng).toBe(-74);
    });

    it("preserves explicit new coords when address and coords both change", async () => {
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { address: "789 Pine Rd", lat: 41, lng: -75 });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBe(41);
        expect(saved?.lng).toBe(-75);
        expect(saved?.address).toBe("789 Pine Rd");
    });
});

describe("usePatientStore.update — calendar refresh fan-out", () => {
    beforeEach(async () => {
        await db.patients.clear();
        await db.appointments.clear();
        vi.clearAllMocks();
        usePatientStore.setState({ patients: [], loading: false, error: null, searchQuery: "" });
    });

    function makeAppointment(overrides: Partial<Appointment> & { id: string; patientId: string }): Appointment {
        return {
            date: "2026-08-10",
            startTime: "09:00",
            duration: 45,
            status: "scheduled",
            syncStatus: "synced",
            visitType: null,
            calendarEventId: `evt-${overrides.id}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
    }

    /** Queue rows the fan-out produced, ignoring order. */
    const enqueuedAppointmentIds = () =>
        vi.mocked(syncQueueDB.add).mock.calls
            .map(([item]) => item)
            .filter((item) => item.entity === "appointment" && item.type === "update")
            .map((item) => item.data.entityId)
            .sort();

    it("enqueues an update for every calendar-synced appointment on rename", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([
            makeAppointment({ id: "a1", patientId: id }),
            makeAppointment({ id: "a2", patientId: id }),
        ]);

        await usePatientStore.getState().update(id, { fullName: "Doe, Jonathan" });

        expect(enqueuedAppointmentIds()).toEqual(["a1", "a2"]);
    });

    it("skips appointments that are not on the calendar yet", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([
            makeAppointment({ id: "a1", patientId: id }),
            makeAppointment({ id: "a2", patientId: id, calendarEventId: undefined, syncStatus: "local" }),
        ]);

        await usePatientStore.getState().update(id, { fullName: "Doe, Jonathan" });

        expect(enqueuedAppointmentIds()).toEqual(["a1"]);
    });

    it("skips cancelled appointments", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([
            makeAppointment({ id: "a1", patientId: id }),
            makeAppointment({ id: "a2", patientId: id, status: "cancelled" }),
        ]);

        await usePatientStore.getState().update(id, { fullName: "Doe, Jonathan" });

        expect(enqueuedAppointmentIds()).toEqual(["a1"]);
    });

    it("does not fan out when an unrelated field changes", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([makeAppointment({ id: "a1", patientId: id })]);

        await usePatientStore.getState().update(id, { notes: "Gate code 4412" });

        expect(enqueuedAppointmentIds()).toEqual([]);
    });

    it("does not fan out when the name is submitted unchanged", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([makeAppointment({ id: "a1", patientId: id })]);

        await usePatientStore.getState().update(id, { fullName: basePatient.fullName });

        expect(enqueuedAppointmentIds()).toEqual([]);
    });

    it("fans out on an address change too, since it is the event location", async () => {
        const id = await patientDB.add(basePatient);
        await db.appointments.bulkPut([makeAppointment({ id: "a1", patientId: id })]);

        await usePatientStore.getState().update(id, { address: "456 Oak Ave" });

        expect(enqueuedAppointmentIds()).toEqual(["a1"]);
    });

    it("leaves another patient's appointments alone", async () => {
        const id = await patientDB.add(basePatient);
        const otherId = await patientDB.add({ ...basePatient, fullName: "Roe, Jane" });
        await db.appointments.bulkPut([
            makeAppointment({ id: "a1", patientId: id }),
            makeAppointment({ id: "b1", patientId: otherId }),
        ]);

        await usePatientStore.getState().update(id, { fullName: "Doe, Jonathan" });

        expect(enqueuedAppointmentIds()).toEqual(["a1"]);
    });
});
