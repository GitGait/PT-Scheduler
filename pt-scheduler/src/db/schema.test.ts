import { describe, it, expect, beforeEach } from "vitest";
import { db, PTSchedulerDB } from "./schema";

describe("PTSchedulerDB Schema", () => {
    beforeEach(async () => {
        // Clear all tables before each test
        await db.patients.clear();
        await db.appointments.clear();
        await db.recurringBlocks.clear();
        await db.calendarEvents.clear();
        await db.syncQueue.clear();
        await db.routeCache.clear();
    });

    it("should be an instance of PTSchedulerDB", () => {
        expect(db).toBeInstanceOf(PTSchedulerDB);
    });

    it("should have all required tables", () => {
        expect(db.patients).toBeDefined();
        expect(db.appointments).toBeDefined();
        expect(db.recurringBlocks).toBeDefined();
        expect(db.calendarEvents).toBeDefined();
        expect(db.syncQueue).toBeDefined();
        expect(db.routeCache).toBeDefined();
    });

    it("should have correct database name", () => {
        expect(db.name).toBe("PTSchedulerDB");
    });

    it("should allow adding a patient directly", async () => {
        const patient = {
            id: "test-patient-1",
            fullName: "Doe, John",
            nicknames: ["Johnny"],
            phone: "555-1234",
            alternateContacts: [],
            address: "123 Main St",
            status: "active" as const,
            notes: "",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.patients.add(patient);
        const retrieved = await db.patients.get("test-patient-1");

        expect(retrieved).toBeDefined();
        expect(retrieved?.fullName).toBe("Doe, John");
    });

    it("should allow adding an appointment directly", async () => {
        const appointment = {
            id: "test-appt-1",
            patientId: "test-patient-1",
            date: "2026-02-07",
            startTime: "09:00",
            duration: 60,
            status: "scheduled" as const,
            syncStatus: "local" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.appointments.add(appointment);
        const retrieved = await db.appointments.get("test-appt-1");

        expect(retrieved).toBeDefined();
        expect(retrieved?.date).toBe("2026-02-07");
    });

    it("should allow adding to sync queue with auto-increment", async () => {
        const item = {
            type: "create" as const,
            entity: "appointment" as const,
            data: { test: true },
            timestamp: new Date(),
            retryCount: 0,
            status: "pending" as const,
        };

        const id = await db.syncQueue.add(item);

        expect(typeof id).toBe("number");
        expect(id).toBeGreaterThan(0);
    });
});
