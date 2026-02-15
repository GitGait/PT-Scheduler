/**
 * Sync hook for managing Google Sheets/Calendar synchronization.
 */

import { useEffect, useCallback, useRef, useState } from "react";
import { useSyncStore, usePatientStore } from "../stores";
import { isSignedIn, getAccessToken } from "../api/auth";
import {
    deletePatientsFromSheetByIds,
    fetchPatientsFromSheet,
    syncPatientToSheetByStatus,
} from "../api/sheets";
import {
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    listCalendarEvents,
} from "../api/calendar";
import { db } from "../db/schema";
import { reconcilePatientsFromSheetSnapshot } from "../db/patientSheetSync";
import { syncQueueDB } from "../db/operations";
import type { AppointmentStatus, SyncQueueItem, VisitType } from "../types";
import { VISIT_TYPE_CODES } from "../types";

const MAX_BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2500;
const MAX_RETRIES = 5;
const SHEETS_AUTO_SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const APPOINTMENT_BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;
const CALENDAR_POLL_INTERVAL_MS = 120000; // 2 minutes
const CALENDAR_LOOKBACK_DAYS = 30;
const CALENDAR_LOOKAHEAD_DAYS = 365;
const CALENDAR_METADATA_KEYS = {
    appointmentId: "ptSchedulerAppointmentId",
    patientId: "ptSchedulerPatientId",
    patientName: "ptSchedulerPatientName",
    patientPhone: "ptSchedulerPatientPhone",
    patientAddress: "ptSchedulerPatientAddress",
    status: "ptSchedulerStatus",
    durationMinutes: "ptSchedulerDurationMinutes",
    visitType: "ptSchedulerVisitType",
} as const;

export interface SyncConfig {
    spreadsheetId?: string;
    calendarId?: string;
}

const APPOINTMENTS_SYNCED_EVENT = "pt-scheduler:appointments-synced";
export const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";
const LAST_SHEETS_SYNC_KEY_PREFIX = "ptScheduler.lastSheetsAutoSync.";
const LAST_APPOINTMENT_BACKFILL_KEY_PREFIX = "ptScheduler.lastCalendarBackfill.";

export function useSync(config: SyncConfig | null) {
    const { isOnline, pendingCount, refreshPendingCount } = useSyncStore();
    const { loadAll } = usePatientStore();
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncError, setLastSyncError] = useState<string | null>(null);
    const queueRunInFlightRef = useRef(false);
    const calendarSyncLockRef = useRef(false);

    /**
     * Sync patients from Google Sheets to local database.
     */
    const syncPatientsFromSheets = useCallback(async (options?: { force?: boolean }) => {
        if (!config?.spreadsheetId || !isSignedIn()) return;

        try {
            if (!options?.force && !shouldRunAutoSheetsSync(config.spreadsheetId)) {
                return;
            }

            const patients = await fetchPatientsFromSheet(config.spreadsheetId);
            await reconcilePatientsFromSheetSnapshot(config.spreadsheetId, patients);

            await loadAll();
            markSheetsAutoSyncRun(config.spreadsheetId);
            setLastSyncError(null);
        } catch (err) {
            console.error("Patient sync failed:", err);
            setLastSyncError(err instanceof Error ? err.message : "Sync failed");
        }
    }, [config?.spreadsheetId, loadAll]);

    /**
     * Sync appointments from Google Calendar to local database for cross-device visibility.
     */
    const syncAppointmentsFromCalendar = useCallback(async () => {
        if (!config?.calendarId || !isSignedIn()) return;

        // Prevent concurrent sync operations to avoid data inconsistency
        if (calendarSyncLockRef.current) {
            return;
        }
        calendarSyncLockRef.current = true;

        try {
            let importedAny = false;
            let importedPatientsAny = false;
            const now = new Date();
            const timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - CALENDAR_LOOKBACK_DAYS);
            const timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + CALENDAR_LOOKAHEAD_DAYS);

            const events = await listCalendarEvents(
                config.calendarId,
                timeMin.toISOString(),
                timeMax.toISOString()
            );

            for (const event of events) {
                const start = new Date(event.startDateTime);
                const end = new Date(event.endDateTime);
                if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
                    continue;
                }

                const durationMinutes = Math.max(
                    15,
                    Math.round((end.getTime() - start.getTime()) / 60000)
                );
                const appointmentDate = toLocalIsoDate(start);
                const appointmentStartTime = toLocalTime(start);
                const metadata = event.privateMetadata ?? {};

                const appointmentIdFromMetadata = metadata[CALENDAR_METADATA_KEYS.appointmentId];
                const appointmentId = appointmentIdFromMetadata || `gcal-${event.googleEventId}`;
                const patientName =
                    metadata[CALENDAR_METADATA_KEYS.patientName]?.trim() ||
                    extractPatientNameFromEventSummary(event.summary) ||
                    "Unknown Patient";
                let patientId =
                    metadata[CALENDAR_METADATA_KEYS.patientId] ??
                    (await resolvePatientIdFromEventSummary(event.summary));

                if (!patientId) {
                    patientId = buildImportedPatientId(patientName, event.googleEventId);
                }

                const patientPhone = metadata[CALENDAR_METADATA_KEYS.patientPhone]?.trim() || "";
                const patientAddress =
                    metadata[CALENDAR_METADATA_KEYS.patientAddress]?.trim() ||
                    event.location?.trim() ||
                    "";

                const existingPatient = await db.patients.get(patientId);
                if (!existingPatient) {
                    await db.patients.add({
                        id: patientId,
                        fullName: patientName,
                        nicknames: [],
                        phone: patientPhone,
                        alternateContacts: [],
                        address: patientAddress,
                        status: "active",
                        notes: `Imported from Google Calendar event ${event.googleEventId}`,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    importedPatientsAny = true;
                } else {
                    const nextFullName =
                        existingPatient.fullName.trim() || patientName || "Unknown Patient";
                    const nextPhone = existingPatient.phone?.trim() || patientPhone;
                    const nextAddress = existingPatient.address?.trim() || patientAddress;

                    if (
                        nextFullName !== existingPatient.fullName ||
                        nextPhone !== existingPatient.phone ||
                        nextAddress !== existingPatient.address
                    ) {
                        await db.patients.update(existingPatient.id, {
                            fullName: nextFullName,
                            phone: nextPhone,
                            address: nextAddress,
                            updatedAt: new Date(),
                        });
                        importedPatientsAny = true;
                    }
                }

                const status = parseAppointmentStatus(metadata[CALENDAR_METADATA_KEYS.status]);
                const visitType = parseVisitType(metadata[CALENDAR_METADATA_KEYS.visitType]);
                const existing = await db.appointments.get(appointmentId);

                // Skip overwriting appointments with pending local changes.
                // These will be pushed to the calendar by processQueue; pulling
                // old calendar data here would revert the user's local edits.
                if (existing && (existing.syncStatus === "pending" || existing.syncStatus === "local")) {
                    continue;
                }

                const appointmentRecord = {
                    id: appointmentId,
                    patientId,
                    date: appointmentDate,
                    startTime: appointmentStartTime,
                    duration: Number.isFinite(durationMinutes) ? durationMinutes : 60,
                    status,
                    visitType,
                    syncStatus: "synced" as const,
                    calendarEventId: event.googleEventId,
                    notes: event.description,
                    createdAt: existing?.createdAt ?? new Date(),
                    updatedAt: new Date(),
                };

                if (existing) {
                    await db.appointments.update(appointmentId, appointmentRecord);
                } else {
                    await db.appointments.add(appointmentRecord);
                }
                importedAny = true;

                await db.calendarEvents.put({
                    id: event.googleEventId,
                    appointmentId,
                    googleEventId: event.googleEventId,
                    calendarId: config.calendarId,
                    lastSyncedAt: new Date(),
                });
            }

            if (importedPatientsAny) {
                await loadAll();
            }

            // Check for deleted appointments: remove local appointments whose calendar events no longer exist
            const calendarEventIds = new Set(events.map((e) => e.googleEventId));
            const dateMin = toLocalIsoDate(timeMin);
            const dateMax = toLocalIsoDate(timeMax);

            // Get all local appointments in the sync date range that have a calendarEventId
            const localAppointments = await db.appointments
                .where("date")
                .between(dateMin, dateMax, true, true)
                .toArray();

            let deletedAny = false;
            for (const appointment of localAppointments) {
                // Only check appointments that were synced to calendar
                if (!appointment.calendarEventId) {
                    continue;
                }

                // If the calendar event no longer exists, delete the local appointment
                if (!calendarEventIds.has(appointment.calendarEventId)) {
                    await db.appointments.delete(appointment.id);
                    await db.calendarEvents.where("appointmentId").equals(appointment.id).delete();
                    deletedAny = true;
                }
            }

            if ((importedAny || deletedAny) && typeof window !== "undefined") {
                window.dispatchEvent(new Event(APPOINTMENTS_SYNCED_EVENT));
            }
        } catch (err) {
            console.error("Appointment sync failed:", err);
            setLastSyncError(err instanceof Error ? err.message : "Appointment sync failed");
        } finally {
            calendarSyncLockRef.current = false;
        }
    }, [config?.calendarId, loadAll]);

    const backfillLocalAppointmentsToCalendar = useCallback(async () => {
        if (!config?.calendarId || !isSignedIn()) return;
        if (!shouldRunAppointmentBackfill(config.calendarId)) return;

        try {
            const now = new Date();
            const timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - CALENDAR_LOOKBACK_DAYS);
            const timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + CALENDAR_LOOKAHEAD_DAYS);

            const dateMin = toLocalIsoDate(timeMin);
            const dateMax = toLocalIsoDate(timeMax);
            const appointments = await db.appointments
                .where("date")
                .between(dateMin, dateMax, true, true)
                .toArray();

            let changedAny = false;
            for (const appointment of appointments) {
                const mappedEvent = await db.calendarEvents
                    .where("appointmentId")
                    .equals(appointment.id)
                    .first();
                const knownEventId = appointment.calendarEventId ?? mappedEvent?.googleEventId;

                if (knownEventId) {
                    if (
                        appointment.calendarEventId !== knownEventId ||
                        appointment.syncStatus !== "synced"
                    ) {
                        await db.appointments.update(appointment.id, {
                            calendarEventId: knownEventId,
                            syncStatus: "synced",
                            updatedAt: new Date(),
                        });
                        changedAny = true;
                    }
                    continue;
                }

                const patient = await db.patients.get(appointment.patientId);
                const patientName = patient?.fullName ?? "Unknown";
                const address = patient?.address;
                const patientPhone = patient?.phone;

                const eventId = await createCalendarEvent(
                    config.calendarId,
                    appointment,
                    patientName,
                    address,
                    patientPhone
                );

                await db.appointments.update(appointment.id, {
                    calendarEventId: eventId,
                    syncStatus: "synced",
                    updatedAt: new Date(),
                });

                await db.calendarEvents.put({
                    id: eventId,
                    appointmentId: appointment.id,
                    googleEventId: eventId,
                    calendarId: config.calendarId,
                    lastSyncedAt: new Date(),
                });

                changedAny = true;
            }

            markAppointmentBackfillRun(config.calendarId);

            if (changedAny && typeof window !== "undefined") {
                window.dispatchEvent(new Event(APPOINTMENTS_SYNCED_EVENT));
            }
        } catch (err) {
            console.error("Appointment backfill failed:", err);
            setLastSyncError(err instanceof Error ? err.message : "Appointment backfill failed");
        }
    }, [config?.calendarId]);

    /**
     * Process the sync queue in batches.
     */
    const processQueue = useCallback(async () => {
        if (!config || !isSignedIn() || !isOnline) return;
        if (queueRunInFlightRef.current) return;

        queueRunInFlightRef.current = true;
        setIsSyncing(true);
        setLastSyncError(null);

        try {
            const items = (await syncQueueDB.getPending()).slice(0, MAX_BATCH_SIZE);

            for (const item of items) {
                const queueItemId = typeof item.id === "number" ? item.id : undefined;

                try {
                    await processSyncItem(item, config);
                    if (queueItemId !== undefined) {
                        await db.syncQueue.delete(queueItemId);
                    }
                } catch (err) {
                    await handleSyncItemError(item, err);
                }
            }

            const remaining = (await syncQueueDB.getPending()).length;
            if (remaining > 0) {
                setTimeout(() => {
                    void processQueue();
                }, BATCH_DELAY_MS);
            }

            await refreshPendingCount();
        } catch (err) {
            console.error("Queue processing failed:", err);
            setLastSyncError(err instanceof Error ? err.message : "Queue failed");
        } finally {
            queueRunInFlightRef.current = false;
            setIsSyncing(false);
        }
    }, [config, isOnline, refreshPendingCount]);

    useEffect(() => {
        void refreshPendingCount();
    }, [refreshPendingCount]);

    useEffect(() => {
        if (!isOnline || !config) {
            return;
        }

        const runFullSync = async () => {
            if (!isSignedIn()) {
                return;
            }

            // Push local changes first to avoid pull overwriting them
            const pending = await syncQueueDB.getPendingCount();
            if (pending > 0) {
                await processQueue();
            }

            await backfillLocalAppointmentsToCalendar();
            await syncPatientsFromSheets();
            await syncAppointmentsFromCalendar();
        };

        const runFastSync = async () => {
            if (!isSignedIn()) {
                return;
            }

            // Push local changes first so the calendar has current data
            // before we pull, preventing stale calendar data from
            // overwriting recent local edits.
            const pending = await syncQueueDB.getPendingCount();
            if (pending > 0) {
                await processQueue();
            }

            await syncPatientsFromSheets();
            await syncAppointmentsFromCalendar();
        };

        void runFullSync();

        const intervalId = window.setInterval(() => {
            void runFastSync();
        }, CALENDAR_POLL_INTERVAL_MS);

        const handleWindowFocus = () => {
            void runFastSync();
        };

        const handleRequestSync = () => {
            void runFastSync();
        };

        window.addEventListener("focus", handleWindowFocus);
        window.addEventListener(REQUEST_SYNC_EVENT, handleRequestSync);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", handleWindowFocus);
            window.removeEventListener(REQUEST_SYNC_EVENT, handleRequestSync);
        };
    }, [
        isOnline,
        config,
        backfillLocalAppointmentsToCalendar,
        syncPatientsFromSheets,
        syncAppointmentsFromCalendar,
        processQueue,
    ]);

    useEffect(() => {
        if (isOnline && config && isSignedIn() && pendingCount > 0) {
            void processQueue();
        }
    }, [isOnline, config, pendingCount, processQueue]);

    return {
        isSyncing,
        lastSyncError,
        syncPatientsFromSheets,
        syncAppointmentsFromCalendar,
        processQueue,
    };
}

function toLocalIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function toLocalTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function getSheetsSyncStorageKey(spreadsheetId: string): string {
    return `${LAST_SHEETS_SYNC_KEY_PREFIX}${spreadsheetId}`;
}

function readLastSheetsAutoSyncAt(spreadsheetId: string): number {
    if (typeof window === "undefined") {
        return 0;
    }

    const raw = window.localStorage.getItem(getSheetsSyncStorageKey(spreadsheetId));
    if (!raw) {
        return 0;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function shouldRunAutoSheetsSync(spreadsheetId: string): boolean {
    const lastRun = readLastSheetsAutoSyncAt(spreadsheetId);
    return Date.now() - lastRun >= SHEETS_AUTO_SYNC_COOLDOWN_MS;
}

function markSheetsAutoSyncRun(spreadsheetId: string): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(getSheetsSyncStorageKey(spreadsheetId), String(Date.now()));
}

function getAppointmentBackfillStorageKey(calendarId: string): string {
    return `${LAST_APPOINTMENT_BACKFILL_KEY_PREFIX}${calendarId}`;
}

function shouldRunAppointmentBackfill(calendarId: string): boolean {
    if (typeof window === "undefined") {
        return true;
    }

    const raw = window.localStorage.getItem(getAppointmentBackfillStorageKey(calendarId));
    if (!raw) {
        return true;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return true;
    }

    return Date.now() - parsed >= APPOINTMENT_BACKFILL_COOLDOWN_MS;
}

function markAppointmentBackfillRun(calendarId: string): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(getAppointmentBackfillStorageKey(calendarId), String(Date.now()));
}

function parseAppointmentStatus(value?: string): AppointmentStatus {
    if (value === "completed" || value === "cancelled" || value === "no-show") {
        return value;
    }
    return "scheduled";
}

function parseVisitType(value?: string): VisitType {
    if (value && (VISIT_TYPE_CODES as readonly string[]).includes(value)) {
        return value as VisitType;
    }
    return null;
}

function extractPatientNameFromEventSummary(summary: string): string | null {
    const candidate = summary.replace(/^PT:\s*/i, "").trim();
    return candidate || null;
}

function buildImportedPatientId(patientName: string, fallbackEventId: string): string {
    const slug = patientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);

    if (!slug) {
        return `gcal-patient-${fallbackEventId}`;
    }

    return `gcal-patient-${slug}`;
}

async function resolvePatientIdFromEventSummary(summary: string): Promise<string | null> {
    const normalizedSummary = summary.replace(/^PT:\s*/i, "").trim().toLowerCase();
    if (!normalizedSummary) {
        return null;
    }

    const patients = await db.patients.toArray();
    const patient = patients.find((p) => p.fullName.trim().toLowerCase() === normalizedSummary);
    return patient?.id ?? null;
}

function getEntityId(item: SyncQueueItem): string | undefined {
    const fromData =
        item.data.entityId ??
        item.data.patientId ??
        item.data.appointmentId ??
        item.data.id;

    if (typeof fromData === "string") return fromData;
    if (typeof fromData === "number") return String(fromData);
    return undefined;
}

/**
 * Process a single sync queue item.
 */
async function processSyncItem(item: SyncQueueItem, config: SyncConfig): Promise<void> {
    const token = await getAccessToken();
    if (!token) throw new Error("Not authenticated");

    const action = item.type;
    const entityId = getEntityId(item);

    switch (item.entity) {
        case "patient": {
            if (!config.spreadsheetId) {
                throw new Error("Spreadsheet ID not configured");
            }
            if ((action === "create" || action === "update") && entityId) {
                const patient = await db.patients.get(entityId);
                if (patient) {
                    await syncPatientToSheetByStatus(config.spreadsheetId, patient);
                }
            } else if (action === "delete" && entityId) {
                await deletePatientsFromSheetByIds(config.spreadsheetId, [entityId]);
            }
            break;
        }

        case "appointment": {
            if (!config.calendarId) {
                throw new Error("Calendar ID not configured");
            }
            if (!entityId) {
                return;
            }

            const appointment = await db.appointments.get(entityId);

            if (action === "create") {
                if (!appointment) return;
                const patient = await db.patients.get(appointment.patientId);
                const patientName = patient?.fullName ?? "Unknown";
                const address = patient?.address;
                const patientPhone = patient?.phone;
                const eventId = await createCalendarEvent(
                    config.calendarId,
                    appointment,
                    patientName,
                    address,
                    patientPhone
                );
                await db.appointments.update(appointment.id, {
                    calendarEventId: eventId,
                    syncStatus: "synced",
                    updatedAt: new Date(),
                });
                await db.calendarEvents.put({
                    id: eventId,
                    appointmentId: appointment.id,
                    googleEventId: eventId,
                    calendarId: config.calendarId,
                    lastSyncedAt: new Date(),
                });
            } else if (action === "update") {
                if (!appointment) return;
                const patient = await db.patients.get(appointment.patientId);
                const patientName = patient?.fullName ?? "Unknown";
                const address = patient?.address;
                const patientPhone = patient?.phone;
                const calEvent =
                    (appointment.calendarEventId
                        ? await db.calendarEvents.get(appointment.calendarEventId)
                        : undefined) ??
                    (await db.calendarEvents.where("appointmentId").equals(appointment.id).first());
                if (calEvent?.googleEventId) {
                    await updateCalendarEvent(
                        config.calendarId,
                        calEvent.googleEventId,
                        appointment,
                        patientName,
                        address,
                        patientPhone
                    );
                    await db.appointments.update(appointment.id, {
                        syncStatus: "synced",
                        calendarEventId: calEvent.googleEventId,
                        updatedAt: new Date(),
                    });
                    await db.calendarEvents.put({
                        id: calEvent.googleEventId,
                        appointmentId: appointment.id,
                        googleEventId: calEvent.googleEventId,
                        calendarId: config.calendarId,
                        lastSyncedAt: new Date(),
                    });
                } else {
                    // If event mapping is missing, recover by creating a new event.
                    const newEventId = await createCalendarEvent(
                        config.calendarId,
                        appointment,
                        patientName,
                        address,
                        patientPhone
                    );
                    await db.appointments.update(appointment.id, {
                        calendarEventId: newEventId,
                        syncStatus: "synced",
                        updatedAt: new Date(),
                    });
                    await db.calendarEvents.put({
                        id: newEventId,
                        appointmentId: appointment.id,
                        googleEventId: newEventId,
                        calendarId: config.calendarId,
                        lastSyncedAt: new Date(),
                    });
                }
            } else if (action === "delete") {
                const eventIdFromQueue =
                    typeof item.data.calendarEventId === "string"
                        ? item.data.calendarEventId
                        : undefined;
                const calEvent = entityId
                    ? await db.calendarEvents.where("appointmentId").equals(entityId).first()
                    : undefined;
                const eventId =
                    eventIdFromQueue ??
                    calEvent?.googleEventId ??
                    appointment?.calendarEventId;

                if (eventId) {
                    await deleteCalendarEvent(config.calendarId, eventId);
                    await db.calendarEvents.delete(eventId);
                }
                if (entityId) {
                    await db.calendarEvents.where("appointmentId").equals(entityId).delete();
                }
            }
            break;
        }

        default:
            break;
    }
}

/**
 * Handle sync item error with exponential backoff.
 */
async function handleSyncItemError(item: SyncQueueItem, error: unknown): Promise<void> {
    const queueItemId = typeof item.id === "number" ? item.id : undefined;
    if (queueItemId === undefined) {
        return;
    }

    const retryCount = (item.retryCount ?? 0) + 1;
    const lastError = error instanceof Error ? error.message : "Unknown error";

    if (retryCount >= MAX_RETRIES) {
        await db.syncQueue.update(queueItemId, {
            status: "failed",
            retryCount,
            lastError,
        });
    } else {
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 60000);
        await db.syncQueue.update(queueItemId, {
            status: "pending",
            retryCount,
            lastError,
            nextRetryAt: new Date(Date.now() + backoffMs),
        });
    }
}
