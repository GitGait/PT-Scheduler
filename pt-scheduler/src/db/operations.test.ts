import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./schema";
import {
    patientDB,
    appointmentDB,
    syncQueueDB,
    distanceCacheDB,
    makeCoordKey,
} from "./operations";

describe("patientDB", () => {
    beforeEach(async () => {
        await db.patients.clear();
    });

    it("should add a patient and return id", async () => {
        const id = await patientDB.add({
            fullName: "Smith, Jane",
            nicknames: ["Janey"],
            phoneNumbers: [{ number: "555-5678", label: "mobile" }],
            alternateContacts: [],
            address: "456 Oak Ave",
            status: "active",
            notes: "Test patient",
        });

        expect(id).toBeDefined();
        expect(typeof id).toBe("string");

        const patient = await patientDB.get(id);
        expect(patient?.fullName).toBe("Smith, Jane");
    });

    it("should search patients by name", async () => {
        await patientDB.add({
            fullName: "Johnson, Robert",
            nicknames: ["Bob"],
            phoneNumbers: [{ number: "555-1111" }],
            alternateContacts: [],
            address: "789 Elm St",
            status: "active",
            notes: "",
        });

        const byFullName = await patientDB.search("johnson");
        expect(byFullName).toHaveLength(1);
        expect(byFullName[0].fullName).toBe("Johnson, Robert");

        const byNickname = await patientDB.search("Bob");
        expect(byNickname).toHaveLength(1);
    });

    it("should discharge and reactivate patient", async () => {
        const id = await patientDB.add({
            fullName: "Williams, Sarah",
            nicknames: [],
            phoneNumbers: [{ number: "555-2222" }],
            alternateContacts: [],
            address: "321 Pine St",
            status: "active",
            notes: "",
        });

        await patientDB.discharge(id);
        let patient = await patientDB.get(id);
        expect(patient?.status).toBe("discharged");

        await patientDB.reactivate(id);
        patient = await patientDB.get(id);
        expect(patient?.status).toBe("active");
    });

    it("should upsert patient", async () => {
        const patient = {
            id: "upsert-test-id",
            fullName: "Brown, Mike",
            nicknames: [],
            phoneNumbers: [{ number: "555-3333" }],
            alternateContacts: [],
            address: "111 Cedar Ln",
            status: "active" as const,
            notes: "",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // First upsert creates
        await patientDB.upsert(patient);
        let retrieved = await patientDB.get("upsert-test-id");
        expect(retrieved?.fullName).toBe("Brown, Mike");

        // Second upsert updates
        await patientDB.upsert({ ...patient, notes: "Updated" });
        retrieved = await patientDB.get("upsert-test-id");
        expect(retrieved?.notes).toBe("Updated");
    });

    it("should get all patients by status", async () => {
        await patientDB.add({
            fullName: "Active, One",
            nicknames: [],
            phoneNumbers: [{ number: "555-0001" }],
            alternateContacts: [],
            address: "1 Active St",
            status: "active",
            notes: "",
        });
        await patientDB.add({
            fullName: "Discharged, One",
            nicknames: [],
            phoneNumbers: [{ number: "555-0002" }],
            alternateContacts: [],
            address: "1 Discharged St",
            status: "discharged",
            notes: "",
        });

        const active = await patientDB.getAll("active");
        expect(active).toHaveLength(1);
        expect(active[0].fullName).toBe("Active, One");

        const all = await patientDB.getAll();
        expect(all).toHaveLength(2);
    });

    it("should search patients by phone number across all entries", async () => {
        await patientDB.add({
            fullName: "MultiPhone, Test",
            nicknames: [],
            phoneNumbers: [
                { number: "555-1111", label: "Cell" },
                { number: "555-2222", label: "Home" },
            ],
            alternateContacts: [],
            address: "1 Test St",
            status: "active",
            notes: "",
        });

        const byFirst = await patientDB.search("5551111");
        expect(byFirst).toHaveLength(1);

        const bySecond = await patientDB.search("5552222");
        expect(bySecond).toHaveLength(1);
        expect(bySecond[0].fullName).toBe("MultiPhone, Test");
    });
});

describe("appointmentDB", () => {
    beforeEach(async () => {
        await db.appointments.clear();
    });

    it("should create appointment and return id", async () => {
        const id = await appointmentDB.create({
            patientId: "patient-1",
            date: "2026-02-10",
            startTime: "10:00",
            duration: 45,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        expect(id).toBeDefined();
        const appt = await appointmentDB.get(id);
        expect(appt?.date).toBe("2026-02-10");
    });

    it("should get appointments by date", async () => {
        await appointmentDB.create({
            patientId: "p1",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });
        await appointmentDB.create({
            patientId: "p2",
            date: "2026-02-10",
            startTime: "11:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });
        await appointmentDB.create({
            patientId: "p3",
            date: "2026-02-11",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        const feb10 = await appointmentDB.byDate("2026-02-10");
        expect(feb10).toHaveLength(2);

        const feb11 = await appointmentDB.byDate("2026-02-11");
        expect(feb11).toHaveLength(1);
    });

    it("should get appointments by date range", async () => {
        await appointmentDB.create({
            patientId: "p1",
            date: "2026-02-08",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });
        await appointmentDB.create({
            patientId: "p2",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });
        await appointmentDB.create({
            patientId: "p3",
            date: "2026-02-12",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        const range = await appointmentDB.byRange("2026-02-09", "2026-02-11");
        expect(range).toHaveLength(1);
        expect(range[0].date).toBe("2026-02-10");
    });

    it("should update appointment", async () => {
        const id = await appointmentDB.create({
            patientId: "p1",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        await appointmentDB.update(id, { status: "completed", notes: "All done" });
        const appt = await appointmentDB.get(id);
        expect(appt?.status).toBe("completed");
        expect(appt?.notes).toBe("All done");
    });

    it("should delete appointment", async () => {
        const id = await appointmentDB.create({
            patientId: "p1",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        await appointmentDB.delete(id);
        const appt = await appointmentDB.get(id);
        expect(appt).toBeUndefined();
    });

    it("should mark appointment as synced", async () => {
        const id = await appointmentDB.create({
            patientId: "p1",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
            visitType: null,
        });

        await appointmentDB.markSynced(id, "google-event-123");
        const appt = await appointmentDB.get(id);
        expect(appt?.syncStatus).toBe("synced");
        expect(appt?.calendarEventId).toBe("google-event-123");
    });
});

describe("syncQueueDB", () => {
    beforeEach(async () => {
        await db.syncQueue.clear();
    });

    it("should add item to queue", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "p1" },
        });

        expect(id).toBeGreaterThan(0);
    });

    it("should get pending items", async () => {
        await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "apt-1" },
        });
        await syncQueueDB.add({
            type: "update",
            entity: "patient",
            data: { entityId: "pt-2" },
        });

        const pending = await syncQueueDB.getPending();
        expect(pending).toHaveLength(2);
    });

    it("should mark item as processing", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "test" },
        });

        await syncQueueDB.markProcessing(id);
        const item = await db.syncQueue.get(id);
        expect(item?.status).toBe("processing");
    });

    it("should mark item as failed with retry scheduling", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "test" },
        });

        await syncQueueDB.markFailed(id, "Network error");
        const item = await db.syncQueue.get(id);

        expect(item?.status).toBe("pending"); // Still pending for retry
        expect(item?.retryCount).toBe(1);
        expect(item?.lastError).toBe("Network error");
        expect(item?.nextRetryAt).toBeDefined();
    });

    it("should mark item as failed after max retries", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "test" },
        });

        // Fail 5 times
        for (let i = 0; i < 5; i++) {
            await syncQueueDB.markFailed(id, `Error ${i + 1}`);
        }

        const item = await db.syncQueue.get(id);
        expect(item?.status).toBe("failed");
        expect(item?.retryCount).toBe(5);
    });

    it("should remove item", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "test" },
        });

        await syncQueueDB.remove(id);
        const item = await db.syncQueue.get(id);
        expect(item).toBeUndefined();
    });

    it("should get pending count", async () => {
        await syncQueueDB.add({ type: "create", entity: "appointment", data: { entityId: "a" } });
        await syncQueueDB.add({ type: "update", entity: "patient", data: { entityId: "b" } });

        const count = await syncQueueDB.getPendingCount();
        expect(count).toBe(2);
    });

    it("should mark item as synced", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { entityId: "test" },
        });

        await syncQueueDB.markSynced(id);
        const item = await db.syncQueue.get(id);
        expect(item?.status).toBe("synced");
    });
});

describe("distanceCacheDB", () => {
    beforeEach(async () => {
        await db.distanceCache.clear();
    });

    it("should put and get an entry by coordKey", async () => {
        const entry = {
            coordKey: "40.0000,-74.0000->40.1000,-74.1000",
            distanceMiles: 8.5,
            durationMinutes: 17,
            createdAt: new Date("2026-04-15T12:00:00Z"),
        };

        await distanceCacheDB.put(entry);
        const retrieved = await distanceCacheDB.get(entry.coordKey);

        expect(retrieved).toBeDefined();
        expect(retrieved?.coordKey).toBe(entry.coordKey);
        expect(retrieved?.distanceMiles).toBe(8.5);
        expect(retrieved?.durationMinutes).toBe(17);
        expect(retrieved?.createdAt).toEqual(entry.createdAt);
    });

    it("should return undefined for an unknown key", async () => {
        const result = await distanceCacheDB.get("nonexistent->key");
        expect(result).toBeUndefined();
    });

    it("getMany should return a Map containing only the hits", async () => {
        const hit1 = {
            coordKey: "40.0000,-74.0000->40.1000,-74.1000",
            distanceMiles: 8.5,
            durationMinutes: 17,
            createdAt: new Date(),
        };
        const hit2 = {
            coordKey: "40.2000,-74.2000->40.3000,-74.3000",
            distanceMiles: 5.2,
            durationMinutes: 11,
            createdAt: new Date(),
        };

        await distanceCacheDB.put(hit1);
        await distanceCacheDB.put(hit2);

        const missKey = "99.9999,-99.9999->88.8888,-88.8888";
        const result = await distanceCacheDB.getMany([
            hit1.coordKey,
            missKey,
            hit2.coordKey,
        ]);

        expect(result.size).toBe(2);
        expect(result.get(hit1.coordKey)?.distanceMiles).toBe(8.5);
        expect(result.get(hit2.coordKey)?.distanceMiles).toBe(5.2);
        expect(result.has(missKey)).toBe(false);
    });

    it("putMany should bulk insert entries retrievable via getMany", async () => {
        const entries = [
            {
                coordKey: "40.0000,-74.0000->40.1000,-74.1000",
                distanceMiles: 8.5,
                durationMinutes: 17,
                createdAt: new Date(),
            },
            {
                coordKey: "40.1000,-74.1000->40.2000,-74.2000",
                distanceMiles: 6.3,
                durationMinutes: 14,
                createdAt: new Date(),
            },
            {
                coordKey: "40.2000,-74.2000->40.3000,-74.3000",
                distanceMiles: 5.2,
                durationMinutes: 11,
                createdAt: new Date(),
            },
        ];

        await distanceCacheDB.putMany(entries);

        const result = await distanceCacheDB.getMany(entries.map((e) => e.coordKey));
        expect(result.size).toBe(3);
        expect(result.get(entries[0].coordKey)?.distanceMiles).toBe(8.5);
        expect(result.get(entries[1].coordKey)?.distanceMiles).toBe(6.3);
        expect(result.get(entries[2].coordKey)?.distanceMiles).toBe(5.2);
    });

    it("putMany with an empty array is a no-op and does not throw", async () => {
        await expect(distanceCacheDB.putMany([])).resolves.toBeUndefined();
    });
});

describe("makeCoordKey", () => {
    it("should produce different keys for opposite directions", () => {
        const a = { lat: 40.0, lng: -74.0 };
        const b = { lat: 40.1, lng: -74.1 };

        const ab = makeCoordKey(a, b);
        const ba = makeCoordKey(b, a);

        expect(ab).not.toBe(ba);
        expect(ab).toBe("40.0000,-74.0000->40.1000,-74.1000");
        expect(ba).toBe("40.1000,-74.1000->40.0000,-74.0000");
    });

    it("should round coordinates to 4 decimals (sub-5th-decimal inputs collapse)", () => {
        const from1 = { lat: 40.00001, lng: -74.00001 };
        const from2 = { lat: 40.00002, lng: -74.00002 };
        const to = { lat: 40.5, lng: -74.5 };

        const key1 = makeCoordKey(from1, to);
        const key2 = makeCoordKey(from2, to);

        expect(key1).toBe(key2);
        expect(key1).toBe("40.0000,-74.0000->40.5000,-74.5000");
    });
});
