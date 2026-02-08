import Dexie, { type EntityTable } from "dexie";
import type {
    Patient,
    Appointment,
    RecurringBlock,
    CalendarEvent,
    SyncQueueItem,
} from "../types";

// Route cache for storing optimized route results
export interface RouteCache {
    id: string;
    date: string;
    appointmentIds: string[];
    optimizedOrder: string[];
    totalDriveMinutes: number;
    totalMiles: number;
    createdAt: Date;
    expiresAt: Date;
}

// Database class extending Dexie
export class PTSchedulerDB extends Dexie {
    patients!: EntityTable<Patient, "id">;
    appointments!: EntityTable<Appointment, "id">;
    recurringBlocks!: EntityTable<RecurringBlock, "id">;
    calendarEvents!: EntityTable<CalendarEvent, "id">;
    syncQueue!: EntityTable<SyncQueueItem, "id">;
    routeCache!: EntityTable<RouteCache, "id">;

    constructor() {
        super("PTSchedulerDB");

        this.version(1).stores({
            // Primary key + indexed fields
            patients: "id, fullName, status",
            appointments: "id, patientId, date, status, syncStatus",
            recurringBlocks: "id, patientId, dayOfWeek",
            calendarEvents: "id, appointmentId, googleEventId",
            syncQueue: "++id, timestamp, status, nextRetryAt",
            routeCache: "id, date, expiresAt",
        });
    }
}

// Singleton database instance
export const db = new PTSchedulerDB();
