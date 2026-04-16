import { v4 as uuidv4 } from "uuid";
import { db } from "./schema";
import type { CachedGeocode } from "./schema";
import type {
    Patient,
    Appointment,
    DayNote,
    SyncQueueItem,
    PatientStatus,
    SyncStatus,
} from "../types";

// =============================================================================
// Deleted Patient Tracking (prevents calendar sync from recreating deleted patients)
// =============================================================================

const DELETED_PATIENTS_KEY = "ptScheduler.deletedPatientIds";

export function trackDeletedPatientId(id: string): void {
    const ids = getDeletedPatientIds();
    ids.add(id);
    localStorage.setItem(DELETED_PATIENTS_KEY, JSON.stringify([...ids]));
}

export function getDeletedPatientIds(): Set<string> {
    try {
        const raw = localStorage.getItem(DELETED_PATIENTS_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as string[];
        return new Set(parsed);
    } catch {
        return new Set();
    }
}

// =============================================================================
// Deleted Appointment Tracking (prevents sync reload from resurrecting deleted appointments)
// =============================================================================

const DELETED_APPOINTMENTS_KEY = "ptScheduler.deletedAppointmentIds";
const DELETED_APPOINTMENT_TTL_MS = 60 * 60 * 1000; // 1 hour

export function trackDeletedAppointmentId(id: string): void {
    const entries = getRawDeletedAppointmentEntries();
    entries[id] = Date.now();
    localStorage.setItem(DELETED_APPOINTMENTS_KEY, JSON.stringify(entries));
}

export function getDeletedAppointmentIds(): Set<string> {
    const entries = getRawDeletedAppointmentEntries();
    const now = Date.now();
    const ids = new Set<string>();
    for (const [id, timestamp] of Object.entries(entries)) {
        if (now - timestamp < DELETED_APPOINTMENT_TTL_MS) {
            ids.add(id);
        }
    }
    return ids;
}

export function clearDeletedAppointmentId(id: string): void {
    const entries = getRawDeletedAppointmentEntries();
    delete entries[id];
    localStorage.setItem(DELETED_APPOINTMENTS_KEY, JSON.stringify(entries));
}

export function cleanExpiredDeletedAppointmentIds(): void {
    const entries = getRawDeletedAppointmentEntries();
    const now = Date.now();
    let changed = false;
    for (const [id, timestamp] of Object.entries(entries)) {
        if (now - timestamp >= DELETED_APPOINTMENT_TTL_MS) {
            delete entries[id];
            changed = true;
        }
    }
    if (changed) {
        localStorage.setItem(DELETED_APPOINTMENTS_KEY, JSON.stringify(entries));
    }
}

function getRawDeletedAppointmentEntries(): Record<string, number> {
    try {
        const raw = localStorage.getItem(DELETED_APPOINTMENTS_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as Record<string, number>;
    } catch {
        return {};
    }
}

// =============================================================================
// Patient Operations
// =============================================================================

export const patientDB = {
    /** Get patient by ID */
    async get(id: string): Promise<Patient | undefined> {
        return db.patients.get(id);
    },

    /** Search patients by name, nickname, or phone number (case-insensitive partial match) */
    async search(query: string): Promise<Patient[]> {
        const lowerQuery = query.toLowerCase();
        const digitQuery = query.replace(/\D/g, "");
        return db.patients
            .filter(
                (p) =>
                    p.fullName.toLowerCase().includes(lowerQuery) ||
                    p.nicknames.some((n) => n.toLowerCase().includes(lowerQuery)) ||
                    (digitQuery.length >= 3 &&
                        (p.phoneNumbers.some((pn) =>
                            pn.number.replace(/\D/g, "").includes(digitQuery)
                        ) ||
                            p.alternateContacts?.some((c) =>
                                c.phone.replace(/\D/g, "").includes(digitQuery)
                            )))
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

    /** Mark patient as belonging to another PT */
    async markForOtherPt(id: string): Promise<void> {
        await db.patients.update(id, {
            status: "for-other-pt" as PatientStatus,
            forOtherPtAt: new Date(),
            updatedAt: new Date(),
        });
    },

    /** Reactivate patient */
    async reactivate(id: string): Promise<void> {
        await db.patients.update(id, {
            status: "active" as PatientStatus,
            forOtherPtAt: undefined,
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
        trackDeletedPatientId(id);
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

    /** Get appointments by status */
    async byStatus(status: string): Promise<Appointment[]> {
        return db.appointments.where("status").equals(status).toArray();
    },

    /** Mark appointment as synced with calendar */
    async markSynced(id: string, calendarEventId: string): Promise<void> {
        await db.appointments.update(id, {
            syncStatus: "synced" as SyncStatus,
            calendarEventId,
            updatedAt: new Date(),
        });
    },

    /** Find recurring siblings of a personal event (by recurringGroupId or heuristic) */
    async findRecurringSiblings(appointment: Appointment): Promise<Appointment[]> {
        const all = await db.appointments
            .where("patientId")
            .equals("__personal__")
            .toArray();

        return all.filter((a) => {
            if (a.id === appointment.id) return false;
            // If either has a recurringGroupId, require exact match (no heuristic)
            if (appointment.recurringGroupId || a.recurringGroupId) {
                return appointment.recurringGroupId === a.recurringGroupId;
            }
            // Heuristic fallback for pre-existing appointments without groupId
            return (
                a.personalCategory === appointment.personalCategory &&
                (a.title || "") === (appointment.title || "") &&
                a.startTime === appointment.startTime &&
                a.duration === appointment.duration
            );
        });
    },
};

// =============================================================================
// Day Note Operations
// =============================================================================

export const dayNoteDB = {
    /** Create a new day note */
    async create(
        note: Omit<DayNote, "id" | "createdAt" | "updatedAt">
    ): Promise<string> {
        const id = uuidv4();
        const now = new Date();
        await db.dayNotes.add({
            ...note,
            id,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    },

    /** Get day note by ID */
    async get(id: string): Promise<DayNote | undefined> {
        return db.dayNotes.get(id);
    },

    /** Get all notes for a specific date (YYYY-MM-DD) */
    async byDate(date: string): Promise<DayNote[]> {
        return db.dayNotes.where("date").equals(date).toArray();
    },

    /** Get all notes in a date range (inclusive) */
    async byRange(startDate: string, endDate: string): Promise<DayNote[]> {
        return db.dayNotes
            .where("date")
            .between(startDate, endDate, true, true)
            .toArray();
    },

    /** Update day note (partial) */
    async update(
        id: string,
        changes: Partial<Omit<DayNote, "id" | "createdAt">>
    ): Promise<void> {
        await db.dayNotes.update(id, {
            ...changes,
            updatedAt: new Date(),
        });
    },

    /** Delete day note */
    async delete(id: string): Promise<void> {
        await db.dayNotes.delete(id);
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

// =============================================================================
// Geocode Cache Operations
// =============================================================================

// Google Maps Platform ToS §3.2.3(b): Geocoding Content may only be cached
// temporarily. Google's guidance allows up to 30 consecutive calendar days;
// entries older than this MUST be deleted and re-fetched on next access.
export const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const geocodeCacheDB = {
    /**
     * Get cached geocode by normalized address key.
     * Enforces the 30-day TTL: entries older than GEOCODE_TTL_MS are deleted
     * and reported as a miss, forcing a fresh API call on next access.
     */
    async get(addressKey: string): Promise<CachedGeocode | undefined> {
        const hit = await db.geocodeCache.get(addressKey);
        if (!hit) return undefined;
        const age = Date.now() - hit.createdAt.getTime();
        if (age > GEOCODE_TTL_MS) {
            await db.geocodeCache.delete(addressKey);
            return undefined;
        }
        return hit;
    },

    /** Upsert a cached geocode entry */
    async put(entry: CachedGeocode): Promise<void> {
        await db.geocodeCache.put(entry);
    },

    /**
     * Delete all cache entries older than the 30-day TTL.
     * Called opportunistically on app startup to keep the cache compliant
     * even if specific addressKeys are never looked up again.
     */
    async purgeExpired(): Promise<number> {
        const cutoffMs = Date.now() - GEOCODE_TTL_MS;
        return db.geocodeCache
            .filter((row) => row.createdAt.getTime() < cutoffMs)
            .delete();
    },
};

/**
 * Normalize an address string to a stable cache key.
 * Lowercases, collapses internal whitespace, and trims.
 */
export function normalizeAddressKey(address: string): string {
    return address.toLowerCase().replace(/\s+/g, " ").trim();
}
