import Dexie, { type EntityTable } from "dexie";
import {
    VISIT_TYPE_CODES,
    type Patient,
    type Appointment,
    type RecurringBlock,
    type CalendarEvent,
    type SyncQueueItem,
    type DayNote,
    type VisitType,
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
    dayNotes!: EntityTable<DayNote, "id">;

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

        // Version 2: Add visitType field to appointments
        this.version(2)
            .stores({
                patients: "id, fullName, status",
                appointments: "id, patientId, date, status, syncStatus, visitType",
                recurringBlocks: "id, patientId, dayOfWeek",
                calendarEvents: "id, appointmentId, googleEventId",
                syncQueue: "++id, timestamp, status, nextRetryAt",
                routeCache: "id, date, expiresAt",
            })
            .upgrade((tx) => {
                // Migrate existing appointments: extract visitType from notes
                return tx
                    .table("appointments")
                    .toCollection()
                    .modify((appointment) => {
                        if (appointment.visitType === undefined) {
                            appointment.visitType = extractVisitTypeFromNotes(
                                appointment.notes
                            );
                        }
                    });
            });

        // Version 3: Add optional personalCategory and title fields to appointments
        // No new indexes needed - these are optional fields on existing records
        this.version(3).stores({
            patients: "id, fullName, status",
            appointments: "id, patientId, date, status, syncStatus, visitType",
            recurringBlocks: "id, patientId, dayOfWeek",
            calendarEvents: "id, appointmentId, googleEventId",
            syncQueue: "++id, timestamp, status, nextRetryAt",
            routeCache: "id, date, expiresAt",
        });

        // Version 4: Add dayNotes table for sticky notes on calendar days
        this.version(4).stores({
            patients: "id, fullName, status",
            appointments: "id, patientId, date, status, syncStatus, visitType",
            recurringBlocks: "id, patientId, dayOfWeek",
            calendarEvents: "id, appointmentId, googleEventId",
            syncQueue: "++id, timestamp, status, nextRetryAt",
            routeCache: "id, date, expiresAt",
            dayNotes: "id, date",
        });

        // Version 5: Add startMinutes to dayNotes for grid positioning
        this.version(5)
            .stores({
                patients: "id, fullName, status",
                appointments: "id, patientId, date, status, syncStatus, visitType",
                recurringBlocks: "id, patientId, dayOfWeek",
                calendarEvents: "id, appointmentId, googleEventId",
                syncQueue: "++id, timestamp, status, nextRetryAt",
                routeCache: "id, date, expiresAt",
                dayNotes: "id, date",
            })
            .upgrade((tx) => {
                return tx
                    .table("dayNotes")
                    .toCollection()
                    .modify((note) => {
                        if (note.startMinutes === undefined) {
                            note.startMinutes = 720; // noon
                        }
                    });
            });
    }
}

// Valid visit type codes (from single source of truth)
const VALID_VISIT_TYPES = new Set<string>(VISIT_TYPE_CODES);

/**
 * Extract visit type from notes field during migration.
 * Returns a valid VisitType code or null.
 */
function extractVisitTypeFromNotes(notes?: string): VisitType {
    if (!notes?.trim()) {
        return null;
    }

    // Check for labeled format: "Visit Type: PT11"
    const labeledMatch = notes.match(
        /(?:^|\n)\s*visit\s*type\s*[:\-]?\s*([^\n]+)\s*(?:\n|$)/i
    );
    if (labeledMatch) {
        const normalized = normalizeVisitTypeCode(labeledMatch[1]);
        if (normalized && VALID_VISIT_TYPES.has(normalized)) {
            return normalized as VisitType;
        }
    }

    // Check for bracketed format: "[PT11]"
    const bracketedMatch = notes.match(
        /\[\s*([A-Za-z]{1,6}\s*[-]?\s*\d{1,3})\s*\]/i
    );
    if (bracketedMatch) {
        const normalized = normalizeVisitTypeCode(bracketedMatch[1]);
        if (normalized && VALID_VISIT_TYPES.has(normalized)) {
            return normalized as VisitType;
        }
    }

    // Check first line prefix: "PT11 - additional notes"
    const firstLine = notes.split(/\r?\n/)[0]?.trim() ?? "";
    const prefixMatch = firstLine.match(/^([A-Za-z]{1,6}\s*[-]?\s*\d{1,3})\b/i);
    if (prefixMatch) {
        const normalized = normalizeVisitTypeCode(prefixMatch[1]);
        if (normalized && VALID_VISIT_TYPES.has(normalized)) {
            return normalized as VisitType;
        }
    }

    return null;
}

/**
 * Normalize a visit type code string to canonical format (e.g., "PT 11" -> "PT11")
 */
function normalizeVisitTypeCode(value: string): string | null {
    const cleaned = value
        .replace(/^[\[\(\{<]+|[\]\)\}>]+$/g, "")
        .replace(/[–—]/g, "-")
        .replace(/^[\s:;\-]+|[\s:;\-]+$/g, "")
        .replace(/\s+/g, "")
        .trim()
        .toUpperCase();

    if (!cleaned) {
        return null;
    }

    // Match pattern like PT11, PT01, etc.
    const match = cleaned.match(/^([A-Z]{1,6})(\d{1,3})$/);
    if (match) {
        return `${match[1]}${match[2]}`;
    }

    return null;
}

// Singleton database instance
export const db = new PTSchedulerDB();
