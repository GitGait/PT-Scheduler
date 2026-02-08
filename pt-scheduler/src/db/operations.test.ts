import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./schema";
import { patientDB, appointmentDB, syncQueueDB } from "./operations";

describe("patientDB", () => {
    beforeEach(async () => {
        await db.patients.clear();
    });

    it("should add a patient and return id", async () => {
        const id = await patientDB.add({
            fullName: "Smith, Jane",
            nicknames: ["Janey"],
            phone: "555-5678",
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
            phone: "555-1111",
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
            phone: "555-2222",
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
            phone: "555-3333",
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
            phone: "555-0001",
            alternateContacts: [],
            address: "1 Active St",
            status: "active",
            notes: "",
        });
        await patientDB.add({
            fullName: "Discharged, One",
            nicknames: [],
            phone: "555-0002",
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
        });
        await appointmentDB.create({
            patientId: "p2",
            date: "2026-02-10",
            startTime: "11:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
        });
        await appointmentDB.create({
            patientId: "p3",
            date: "2026-02-11",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
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
        });
        await appointmentDB.create({
            patientId: "p2",
            date: "2026-02-10",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
        });
        await appointmentDB.create({
            patientId: "p3",
            date: "2026-02-12",
            startTime: "09:00",
            duration: 60,
            status: "scheduled",
            syncStatus: "local",
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
            data: { patientId: "p1" },
        });

        expect(id).toBeGreaterThan(0);
    });

    it("should get pending items", async () => {
        await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: { id: 1 },
        });
        await syncQueueDB.add({
            type: "update",
            entity: "patient",
            data: { id: 2 },
        });

        const pending = await syncQueueDB.getPending();
        expect(pending).toHaveLength(2);
    });

    it("should mark item as processing", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: {},
        });

        await syncQueueDB.markProcessing(id);
        const item = await db.syncQueue.get(id);
        expect(item?.status).toBe("processing");
    });

    it("should mark item as failed with retry scheduling", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: {},
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
            data: {},
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
            data: {},
        });

        await syncQueueDB.remove(id);
        const item = await db.syncQueue.get(id);
        expect(item).toBeUndefined();
    });

    it("should get pending count", async () => {
        await syncQueueDB.add({ type: "create", entity: "appointment", data: {} });
        await syncQueueDB.add({ type: "update", entity: "patient", data: {} });

        const count = await syncQueueDB.getPendingCount();
        expect(count).toBe(2);
    });

    it("should mark item as synced", async () => {
        const id = await syncQueueDB.add({
            type: "create",
            entity: "appointment",
            data: {},
        });

        await syncQueueDB.markSynced(id);
        const item = await db.syncQueue.get(id);
        expect(item?.status).toBe("synced");
    });
});
