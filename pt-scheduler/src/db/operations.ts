import { v4 as uuidv4 } from "uuid";
import { db } from "./schema";
import type {
    Patient,
    Appointment,
    SyncQueueItem,
    PatientStatus,
    SyncStatus,
} from "../types";

// =============================================================================
// Patient Operations
// =============================================================================

export const patientDB = {
    /** Get patient by ID */
    async get(id: string): Promise<Patient | undefined> {
        return db.patients.get(id);
    },

    /** Search patients by fullName (case-insensitive partial match) */
    async search(query: string): Promise<Patient[]> {
        const lowerQuery = query.toLowerCase();
        return db.patients
            .filter(
                (p) =>
                    p.fullName.toLowerCase().includes(lowerQuery) ||
                    p.nicknames.some((n) => n.toLowerCase().includes(lowerQuery))
            )
            .toArray();
    },

    /** Get all patients, optionally filtered by status */
    async getAll(status?: PatientStatus): Promise<Patient[]> {
        if (status) {
            return db.patients.where("status").equals(status).toArray();
        }
        return db.patients.toArray();
    },

    /** Add new patient */
    async add(
        patient: Omit<Patient, "id" | "createdAt" | "updatedAt">
    ): Promise<string> {
        const id = uuidv4();
        const now = new Date();
        await db.patients.add({
            ...patient,
            id,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    },

    /** Upsert patient (create or update) */
    async upsert(patient: Patient): Promise<void> {
        const existing = await db.patients.get(patient.id);
        if (existing) {
            await db.patients.update(patient.id, {
                ...patient,
                updatedAt: new Date(),
            });
        } else {
            await db.patients.add({
                ...patient,
                createdAt: patient.createdAt || new Date(),
                updatedAt: new Date(),
            });
        }
    },

    /** Discharge patient */
    async discharge(id: string): Promise<void> {
        await db.patients.update(id, {
            status: "discharged" as PatientStatus,
            updatedAt: new Date(),
        });
    },

    /** Reactivate patient */
    async reactivate(id: string): Promise<void> {
        await db.patients.update(id, {
            status: "active" as PatientStatus,
            updatedAt: new Date(),
        });
    },

    /** Update patient (partial) */
    async update(
        id: string,
        changes: Partial<Omit<Patient, "id" | "createdAt">>
    ): Promise<void> {
        await db.patients.update(id, {
            ...changes,
            updatedAt: new Date(),
        });
    },

    /** Delete patient */
    async delete(id: string): Promise<void> {
        await db.patients.delete(id);
    },
};

// =============================================================================
// Appointment Operations
// =============================================================================

export const appointmentDB = {
    /** Create new appointment */
    async create(
        appt: Omit<Appointment, "id" | "createdAt" | "updatedAt">
    ): Promise<string> {
        const id = uuidv4();
        const now = new Date();
        await db.appointments.add({
            ...appt,
            id,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    },

    /** Get appointment by ID */
    async get(id: string): Promise<Appointment | undefined> {
        return db.appointments.get(id);
    },

    /** Update appointment (partial) */
    async update(
        id: string,
        changes: Partial<Omit<Appointment, "id" | "createdAt">>
    ): Promise<void> {
        await db.appointments.update(id, {
            ...changes,
            updatedAt: new Date(),
        });
    },

    /** Delete appointment */
    async delete(id: string): Promise<void> {
        await db.appointments.delete(id);
    },

    /** Get appointments by date (ISO string YYYY-MM-DD) */
    async byDate(date: string): Promise<Appointment[]> {
        return db.appointments.where("date").equals(date).toArray();
    },

    /** Get appointments in date range (inclusive) */
    async byRange(startDate: string, endDate: string): Promise<Appointment[]> {
        return db.appointments
            .where("date")
            .between(startDate, endDate, true, true)
            .toArray();
    },

    /** Get appointments for patient */
    async byPatient(patientId: string): Promise<Appointment[]> {
        return db.appointments.where("patientId").equals(patientId).toArray();
    },

    /** Mark appointment as synced with calendar */
    async markSynced(id: string, calendarEventId: string): Promise<void> {
        await db.appointments.update(id, {
            syncStatus: "synced" as SyncStatus,
            calendarEventId,
            updatedAt: new Date(),
        });
    },
};

// =============================================================================
// Sync Queue Operations
// =============================================================================

const RETRY_DELAYS_MS = [
    1000 * 60, // 1 min
    1000 * 60 * 5, // 5 min
    1000 * 60 * 15, // 15 min
    1000 * 60 * 60, // 1 hour
    1000 * 60 * 60 * 4, // 4 hours
];

export const syncQueueDB = {
    /** Add item to sync queue */
    async add(
        item: Omit<SyncQueueItem, "id" | "timestamp" | "retryCount" | "status">
    ): Promise<number> {
        const id = await db.syncQueue.add({
            ...item,
            timestamp: new Date(),
            retryCount: 0,
            status: "pending",
        });
        return id as number;
    },

    /** Get all pending items ready for processing */
    async getPending(): Promise<SyncQueueItem[]> {
        const now = new Date();
        return db.syncQueue
            .where("status")
            .equals("pending")
            .filter((item) => !item.nextRetryAt || item.nextRetryAt <= now)
            .toArray();
    },

    /** Mark item as processing */
    async markProcessing(id: number): Promise<void> {
        await db.syncQueue.update(id, { status: "processing" });
    },

    /** Mark item as failed with retry scheduling */
    async markFailed(id: number, error: string): Promise<void> {
        const item = await db.syncQueue.get(id);
        if (!item) return;

        const newRetryCount = item.retryCount + 1;
        const delayMs =
            RETRY_DELAYS_MS[Math.min(newRetryCount - 1, RETRY_DELAYS_MS.length - 1)];
        const nextRetryAt = new Date(Date.now() + delayMs);

        await db.syncQueue.update(id, {
            status: newRetryCount >= 5 ? "failed" : "pending",
            retryCount: newRetryCount,
            lastError: error,
            nextRetryAt,
        });
    },

    /** Mark item as synced (complete) */
    async markSynced(id: number): Promise<void> {
        await db.syncQueue.update(id, { status: "synced" });
    },

    /** Remove item from queue */
    async remove(id: number): Promise<void> {
        await db.syncQueue.delete(id);
    },

    /** Get count of pending items */
    async getPendingCount(): Promise<number> {
        return db.syncQueue.where("status").equals("pending").count();
    },

    /** Get all failed items */
    async getFailed(): Promise<SyncQueueItem[]> {
        return db.syncQueue.where("status").equals("failed").toArray();
    },
};
