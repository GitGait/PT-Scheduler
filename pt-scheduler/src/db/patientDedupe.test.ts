import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./schema";
import { patientDB, getDeletedPatientIds } from "./operations";
import type { Appointment, Patient } from "../types";

// Calendar sync ON, sheets sync OFF, so every syncQueueDB.add below is
// unambiguously the calendar push the merge is supposed to queue.
vi.mock("../stores/syncStore", () => ({
    useSyncStore: {
        getState: () => ({
            spreadsheetId: "",
            calendarId: "cal-1",
            refreshPendingCount: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

vi.mock("./operations", async (importOriginal) => {
    const real = await importOriginal<typeof import("./operations")>();
    return {
        ...real,
        syncQueueDB: {
            add: vi.fn().mockResolvedValue(1),
        },
    };
});

import { syncQueueDB } from "./operations";
import { dedupeLocalPatients, arePatientsLikelyDuplicate, mergePatientRecords } from "./patientDedupe";

const DELETED_PATIENTS_KEY = "ptScheduler.deletedPatientIds";

const basePatient = {
    nicknames: [] as string[],
    phoneNumbers: [] as { number: string; label?: string }[],
    alternateContacts: [],
    address: "",
    status: "active" as const,
    notes: "",
};

async function seedPatient(overrides: Partial<Patient> & { fullName: string }): Promise<string> {
    const id = overrides.id ?? crypto.randomUUID();
    const createdAt = overrides.createdAt ?? new Date();
    await db.patients.put({
        ...basePatient,
        ...overrides,
        id,
        createdAt,
        updatedAt: createdAt,
    } as Patient);
    return id;
}

async function seedAppointment(overrides: Partial<Appointment> & { patientId: string }): Promise<string> {
    const id = overrides.id ?? crypto.randomUUID();
    await db.appointments.put({
        date: "2026-08-18",
        startTime: "09:00",
        duration: 60,
        status: "scheduled",
        visitType: null,
        syncStatus: "synced",
        notes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
        id,
    } as Appointment);
    return id;
}

function queuedAppointmentUpdates(): string[] {
    return vi
        .mocked(syncQueueDB.add)
        .mock.calls.map(([item]) => item)
        .filter((item) => item.entity === "appointment" && item.type === "update")
        .map((item) => item.data.entityId);
}

describe("dedupeLocalPatients", () => {
    beforeEach(async () => {
        await db.patients.clear();
        await db.appointments.clear();
        localStorage.removeItem(DELETED_PATIENTS_KEY);
        vi.clearAllMocks();
    });

    it("merges a duplicate into the earliest-created canonical record", async () => {
        const canonicalId = await seedPatient({
            fullName: "John Smith",
            address: "123 Main St",
            createdAt: new Date("2026-01-01"),
        });
        const duplicateId = await seedPatient({
            fullName: "John Smith",
            address: "123 Main St",
            createdAt: new Date("2026-02-01"),
        });

        const result = await dedupeLocalPatients();

        expect(result.removedPatientIds).toEqual([duplicateId]);
        expect(result.canonicalPatientIdsToResync).toEqual([canonicalId]);
        expect(await db.patients.count()).toBe(1);
        expect(await patientDB.get(canonicalId)).toBeDefined();
        expect(await patientDB.get(duplicateId)).toBeUndefined();
    });

    it("tombstones the removed id so the calendar pull cannot recreate it", async () => {
        await seedPatient({
            fullName: "Jane Doe",
            address: "5 Oak Ave",
            createdAt: new Date("2026-01-01"),
        });
        const duplicateId = await seedPatient({
            fullName: "Jane Doe",
            address: "5 Oak Ave",
            createdAt: new Date("2026-02-01"),
        });

        await dedupeLocalPatients();

        expect(getDeletedPatientIds().has(duplicateId)).toBe(true);
    });

    it("remaps appointments and marks them pending so a pull cannot revert them", async () => {
        const canonicalId = await seedPatient({
            fullName: "Ann Lee",
            address: "9 Elm St",
            createdAt: new Date("2026-01-01"),
        });
        const duplicateId = await seedPatient({
            fullName: "Ann Lee",
            address: "9 Elm St",
            createdAt: new Date("2026-02-01"),
        });
        const appointmentId = await seedAppointment({
            patientId: duplicateId,
            calendarEventId: "gcal-event-1",
        });

        await dedupeLocalPatients();

        const moved = await db.appointments.get(appointmentId);
        expect(moved?.patientId).toBe(canonicalId);
        // Without "pending" the calendar pull would overwrite patientId back to
        // the merged-away id before the queued push lands.
        expect(moved?.syncStatus).toBe("pending");
    });

    it("queues one calendar update per remapped appointment on the calendar", async () => {
        await seedPatient({
            fullName: "Rob Ray",
            address: "1 Pine Rd",
            createdAt: new Date("2026-01-01"),
        });
        const duplicateId = await seedPatient({
            fullName: "Rob Ray",
            address: "1 Pine Rd",
            createdAt: new Date("2026-02-01"),
        });
        const first = await seedAppointment({ patientId: duplicateId, calendarEventId: "evt-1" });
        const second = await seedAppointment({ patientId: duplicateId, calendarEventId: "evt-2" });

        await dedupeLocalPatients();

        expect(queuedAppointmentUpdates().sort()).toEqual([first, second].sort());
    });

    it("does not queue appointments that are not on the calendar or are cancelled", async () => {
        await seedPatient({
            fullName: "Sam Poe",
            address: "2 Cedar Ln",
            createdAt: new Date("2026-01-01"),
        });
        const duplicateId = await seedPatient({
            fullName: "Sam Poe",
            address: "2 Cedar Ln",
            createdAt: new Date("2026-02-01"),
        });
        // No calendarEventId: nothing on the calendar to rewrite. Queuing this
        // would make the push fall through to createCalendarEvent.
        const notOnCalendar = await seedAppointment({ patientId: duplicateId });
        const cancelled = await seedAppointment({
            patientId: duplicateId,
            calendarEventId: "evt-3",
            status: "cancelled",
        });
        const pushable = await seedAppointment({ patientId: duplicateId, calendarEventId: "evt-4" });

        await dedupeLocalPatients();

        const queued = queuedAppointmentUpdates();
        expect(queued).toEqual([pushable]);
        expect(queued).not.toContain(notOnCalendar);
        expect(queued).not.toContain(cancelled);
    });

    it("leaves distinct patients alone", async () => {
        await seedPatient({
            fullName: "Chris Vale",
            phoneNumbers: [{ number: "555-0100" }],
            createdAt: new Date("2026-01-01"),
        });
        await seedPatient({
            fullName: "Dana Vale",
            phoneNumbers: [{ number: "555-0200" }],
            createdAt: new Date("2026-02-01"),
        });

        const result = await dedupeLocalPatients();

        expect(result.removedPatientIds).toEqual([]);
        expect(await db.patients.count()).toBe(2);
        expect(getDeletedPatientIds().size).toBe(0);
        expect(queuedAppointmentUpdates()).toEqual([]);
    });
});

describe("arePatientsLikelyDuplicate", () => {
    const identity = (fullName: string, phone = "", address = "") => ({
        fullName,
        phoneNumbers: phone ? [{ number: phone }] : [],
        address,
    });

    it("matches on name plus phone", () => {
        expect(
            arePatientsLikelyDuplicate(
                identity("John Smith", "555-0100"),
                identity("john smith", "(555) 0100")
            )
        ).toBe(true);
    });

    it("matches on name plus address", () => {
        expect(
            arePatientsLikelyDuplicate(
                identity("John Smith", "", "123 Main St."),
                identity("John Smith", "", "123 main st")
            )
        ).toBe(true);
    });

    it("matches on name alone only when both lack phone and address", () => {
        expect(arePatientsLikelyDuplicate(identity("John Smith"), identity("John Smith"))).toBe(true);
        expect(
            arePatientsLikelyDuplicate(identity("John Smith", "555-0100"), identity("John Smith"))
        ).toBe(false);
    });

    it("does not match different people who share an address", () => {
        expect(
            arePatientsLikelyDuplicate(
                identity("John Smith", "", "123 Main St"),
                identity("Mary Smith", "", "123 Main St")
            )
        ).toBe(false);
    });
});

describe("mergePatientRecords", () => {
    const patient = (overrides: Partial<Patient> & { fullName: string }): Patient =>
        ({
            ...basePatient,
            id: crypto.randomUUID(),
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
            ...overrides,
        }) as Patient;

    it("keeps the primary id and the earliest createdAt", () => {
        const primary = patient({ fullName: "John Smith", createdAt: new Date("2026-03-01") });
        const duplicate = patient({ fullName: "John Smith", createdAt: new Date("2026-01-01") });

        const merged = mergePatientRecords(primary, duplicate);

        expect(merged.id).toBe(primary.id);
        expect(merged.createdAt).toEqual(new Date("2026-01-01"));
    });

    it("fills blank primary fields from the duplicate", () => {
        const primary = patient({ fullName: "J Smith", address: "" });
        const duplicate = patient({
            fullName: "Jonathan Smith",
            address: "123 Main St",
            phoneNumbers: [{ number: "555-0100" }],
        });

        const merged = mergePatientRecords(primary, duplicate);

        expect(merged.address).toBe("123 Main St");
        expect(merged.phoneNumbers).toEqual([{ number: "555-0100" }]);
        // Longer name wins — OCR and calendar imports tend to truncate.
        expect(merged.fullName).toBe("Jonathan Smith");
    });
});
