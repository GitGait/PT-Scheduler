/**
 * Google Calendar API integration for appointment sync.
 */

import { getAccessToken } from "./auth";
import { fetchWithTimeout } from "./request";
import type { Appointment } from "../types";
import { PERSONAL_PATIENT_ID } from "../utils/personalEventColors";
import { calendarEventListResponseSchema, parseWithSchema } from "../utils/validation";
import type { CalendarEventListItem } from "../utils/validation";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

async function getCalendarErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const payload = await response.json() as { error?: { message?: string } };
        const message = payload.error?.message;
        if (message) {
            return `${fallback}: ${message}`;
        }
    } catch {
        // Ignore parse errors and use fallback
    }
    return fallback;
}

interface CalendarEvent {
    id?: string;
    summary: string;
    location?: string;
    description?: string;
    extendedProperties?: {
        private?: Record<string, string>;
    };
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
}

export interface CalendarSyncedEvent {
    googleEventId: string;
    summary: string;
    location?: string;
    description?: string;
    startDateTime: string;
    endDateTime: string;
    privateMetadata: Record<string, string>;
}

const CALENDAR_METADATA_KEYS = {
    appointmentId: "ptSchedulerAppointmentId",
    patientId: "ptSchedulerPatientId",
    patientName: "ptSchedulerPatientName",
    patientPhone: "ptSchedulerPatientPhone",
    patientAddress: "ptSchedulerPatientAddress",
    status: "ptSchedulerStatus",
    durationMinutes: "ptSchedulerDurationMinutes",
    visitType: "ptSchedulerVisitType",
    isPersonal: "ptSchedulerIsPersonal",
    personalCategory: "ptSchedulerPersonalCategory",
    personalTitle: "ptSchedulerPersonalTitle",
} as const;

/**
 * Create a calendar event for an appointment.
 */
export async function createCalendarEvent(
    calendarId: string,
    appointment: Appointment,
    patientName: string,
    address?: string,
    patientPhone?: string
): Promise<string> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const event = buildCalendarEvent(appointment, patientName, address, patientPhone);

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
    const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
    });

    if (!response.ok) {
        const fallback = `Calendar API error (${response.status})`;
        throw new Error(await getCalendarErrorMessage(response, fallback));
    }

    const data = await response.json();
    return data.id;
}

/**
 * Update an existing calendar event.
 */
export async function updateCalendarEvent(
    calendarId: string,
    eventId: string,
    appointment: Appointment,
    patientName: string,
    address?: string,
    patientPhone?: string
): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const event = buildCalendarEvent(appointment, patientName, address, patientPhone);

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
    const response = await fetchWithTimeout(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
    });

    if (!response.ok) {
        const fallback = `Calendar API error (${response.status})`;
        throw new Error(await getCalendarErrorMessage(response, fallback));
    }
}

/**
 * Delete a calendar event.
 */
export async function deleteCalendarEvent(
    calendarId: string,
    eventId: string
): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
    const response = await fetchWithTimeout(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 404) {
        const fallback = `Calendar API error (${response.status})`;
        throw new Error(await getCalendarErrorMessage(response, fallback));
    }
}

export interface CalendarListItem {
    id: string;
    summary: string;
    backgroundColor?: string;
    primary?: boolean;
}

/**
 * List user's calendars to verify API access.
 */
export async function listCalendars(): Promise<CalendarListItem[]> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const url = `${CALENDAR_API_BASE}/users/me/calendarList`;
    const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        const fallback = `Calendar List API error (${response.status})`;
        throw new Error(await getCalendarErrorMessage(response, fallback));
    }

    const data = await response.json();
    return (data.items || []).map((cal: { id?: string; summary?: string; backgroundColor?: string; primary?: boolean }) => ({
        id: cal.id || "",
        summary: cal.summary || "Unnamed",
        backgroundColor: cal.backgroundColor,
        primary: cal.primary,
    }));
}

export interface FetchCalendarEventsResult {
    events: Array<{
        id: string;
        summary: string;
        startDateTime: string;
        endDateTime: string;
        location?: string;
    }>;
    error?: string;
}

/**
 * Fetch events from a specific calendar (for external calendars like Personal, Holidays).
 * Returns an object with events array and optional error message for partial failure handling.
 */
export async function fetchCalendarEvents(
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
): Promise<FetchCalendarEventsResult> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("timeMin", timeMinIso);
    url.searchParams.set("timeMax", timeMaxIso);

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        // Return empty events with error info for calendars we don't have access to
        console.warn(`Failed to fetch events from calendar ${calendarId}: ${response.status}`);
        return { events: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const items = data.items || [];

    const events = items
        .filter((item: { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }) =>
            Boolean(item.start?.dateTime || item.start?.date) && Boolean(item.end?.dateTime || item.end?.date)
        )
        .map((item: { id?: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }) => ({
            id: item.id || "",
            summary: item.summary || "",
            startDateTime: item.start?.dateTime || `${item.start?.date}T00:00:00`,
            endDateTime: item.end?.dateTime || `${item.end?.date}T23:59:59`,
            location: item.location,
        }));

    return { events };
}

/**
 * List calendar events in a time range.
 */
export async function listCalendarEvents(
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
): Promise<CalendarSyncedEvent[]> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", timeMinIso);
    url.searchParams.set("timeMax", timeMaxIso);

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        const fallback = `Calendar API error (${response.status})`;
        throw new Error(await getCalendarErrorMessage(response, fallback));
    }

    const raw = await response.json();
    const data = parseWithSchema(calendarEventListResponseSchema, raw, "Calendar events response");
    const items = data.items;

    return items
        .filter((item): item is CalendarEventListItem & { id: string } => Boolean(item.id))
        .filter((item) => Boolean(item.start?.dateTime) && Boolean(item.end?.dateTime))
        .map((item) => ({
            googleEventId: item.id!,
            summary: item.summary ?? "",
            location: item.location,
            description: item.description,
            startDateTime: item.start!.dateTime!,
            endDateTime: item.end!.dateTime!,
            privateMetadata: item.extendedProperties?.private ?? {},
        }));
}

/**
 * Build a calendar event object from an appointment.
 */
function buildCalendarEvent(
    appointment: Appointment,
    patientName: string,
    address?: string,
    patientPhone?: string
): CalendarEvent {
    const startDate = new Date(`${appointment.date}T${appointment.startTime}`);
    const endDate = new Date(startDate.getTime() + appointment.duration * 60000);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const isPersonal = appointment.patientId === PERSONAL_PATIENT_ID;

    const privateMetadata: Record<string, string> = {
        [CALENDAR_METADATA_KEYS.appointmentId]: appointment.id,
        [CALENDAR_METADATA_KEYS.patientId]: appointment.patientId,
        [CALENDAR_METADATA_KEYS.status]: appointment.status,
        [CALENDAR_METADATA_KEYS.durationMinutes]: String(appointment.duration),
    };

    if (isPersonal) {
        privateMetadata[CALENDAR_METADATA_KEYS.isPersonal] = "true";
        privateMetadata[CALENDAR_METADATA_KEYS.personalCategory] = appointment.personalCategory ?? "";
        privateMetadata[CALENDAR_METADATA_KEYS.personalTitle] = appointment.title ?? "";
    } else {
        privateMetadata[CALENDAR_METADATA_KEYS.patientName] = patientName;
        privateMetadata[CALENDAR_METADATA_KEYS.patientPhone] = patientPhone ?? "";
        privateMetadata[CALENDAR_METADATA_KEYS.patientAddress] = address ?? "";
        privateMetadata[CALENDAR_METADATA_KEYS.visitType] = appointment.visitType ?? "";
    }

    return {
        summary: isPersonal
            ? (appointment.title || appointment.personalCategory || "Personal Event")
            : `PT: ${patientName}`,
        location: isPersonal ? undefined : address,
        description: appointment.notes || undefined,
        extendedProperties: {
            private: privateMetadata,
        },
        start: {
            dateTime: startDate.toISOString(),
            timeZone,
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone,
        },
    };
}
