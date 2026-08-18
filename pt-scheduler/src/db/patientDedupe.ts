import { db } from "./schema";
import { patientDB, trackDeletedPatientId } from "./operations";
import { enqueueAppointmentSync } from "../stores/appointmentStore";
import type { Appointment, Patient } from "../types";

// =============================================================================
// Duplicate detection
// =============================================================================

export interface PatientIdentityLike {
    id?: string;
    fullName: string;
    phoneNumbers: { number: string; label?: string }[];
    address: string;
}

function normalizeIdentifier(value?: string): string {
    return (value ?? "").trim();
}

function normalizePersonName(value: string): string {
    const tokens = value
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    if (tokens.length === 0) {
        return "";
    }
    if (tokens.length === 1) {
        return tokens[0];
    }
    return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function normalizePhoneForMatch(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
        return digits.slice(1);
    }
    return digits;
}

function normalizeAddressForMatch(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function buildPatientDedupKeys(patient: PatientIdentityLike): string[] {
    const keys: string[] = [];
    const id = normalizeIdentifier(patient.id);
    const name = normalizePersonName(patient.fullName);
    const phone = normalizePhoneForMatch(patient.phoneNumbers[0]?.number ?? "");
    const address = normalizeAddressForMatch(patient.address);

    if (id) {
        keys.push(`id:${id}`);
    }
    if (name && phone) {
        keys.push(`name_phone:${name}|${phone}`);
    }
    if (name && address) {
        keys.push(`name_address:${name}|${address}`);
    }
    if (name && !phone && !address) {
        keys.push(`name_only:${name}`);
    }

    return keys;
}

export function arePatientsLikelyDuplicate(
    a: PatientIdentityLike,
    b: PatientIdentityLike
): boolean {
    const keysA = buildPatientDedupKeys(a).filter((key) => !key.startsWith("id:"));
    const keysB = new Set(buildPatientDedupKeys(b).filter((key) => !key.startsWith("id:")));
    return keysA.some((key) => keysB.has(key));
}

// =============================================================================
// Record merging
// =============================================================================

function mergeStringValue(preferred: string | undefined, fallback: string | undefined): string {
    const normalizedPreferred = (preferred ?? "").trim();
    if (normalizedPreferred) {
        return normalizedPreferred;
    }
    return (fallback ?? "").trim();
}

function mergeNicknames(a: string[], b: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const nickname of [...a, ...b]) {
        const normalized = nickname.trim();
        if (!normalized) {
            continue;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(normalized);
    }

    return merged;
}

function mergeAlternateContacts(
    a: Patient["alternateContacts"],
    b: Patient["alternateContacts"]
): Patient["alternateContacts"] {
    const seen = new Set<string>();
    const merged: Patient["alternateContacts"] = [];

    for (const contact of [...a, ...b]) {
        const firstName = contact.firstName.trim();
        const phone = contact.phone.trim();
        const relationship = contact.relationship?.trim() ?? "";
        if (!firstName || !phone) {
            continue;
        }
        const key = `${firstName.toLowerCase()}|${normalizePhoneForMatch(phone)}|${relationship.toLowerCase()}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(relationship ? { firstName, phone, relationship } : { firstName, phone });
    }

    return merged;
}

function mergeNotes(preferred: string, fallback: string): string {
    const preferredNormalized = preferred.trim();
    const fallbackNormalized = fallback.trim();
    if (!preferredNormalized) {
        return fallbackNormalized;
    }
    if (!fallbackNormalized) {
        return preferredNormalized;
    }
    if (preferredNormalized.includes(fallbackNormalized)) {
        return preferredNormalized;
    }
    if (fallbackNormalized.includes(preferredNormalized)) {
        return fallbackNormalized;
    }
    return `${preferredNormalized}\n${fallbackNormalized}`.trim();
}

export function mergePatientRecords(primary: Patient, duplicate: Patient): Patient {
    const now = new Date();
    const preferredName =
        primary.fullName.trim().length >= duplicate.fullName.trim().length
            ? primary.fullName
            : duplicate.fullName;

    return {
        ...primary,
        fullName: preferredName.trim() || primary.fullName,
        nicknames: mergeNicknames(primary.nicknames, duplicate.nicknames),
        phoneNumbers: primary.phoneNumbers.length > 0 ? primary.phoneNumbers : duplicate.phoneNumbers,
        alternateContacts: mergeAlternateContacts(
            primary.alternateContacts,
            duplicate.alternateContacts
        ),
        address: mergeStringValue(primary.address, duplicate.address),
        lat: primary.lat ?? duplicate.lat,
        lng: primary.lng ?? duplicate.lng,
        email: mergeStringValue(primary.email, duplicate.email) || undefined,
        status:
            primary.status === "active" || duplicate.status !== "active"
                ? primary.status
                : duplicate.status,
        notes: mergeNotes(primary.notes, duplicate.notes),
        createdAt:
            primary.createdAt <= duplicate.createdAt ? primary.createdAt : duplicate.createdAt,
        updatedAt: now,
    };
}

// =============================================================================
// Local dedupe pass
// =============================================================================

export interface LocalPatientDedupeResult {
    removedPatientIds: string[];
    canonicalPatientIdsToResync: string[];
}

/** An appointment moved off a merged-away duplicate onto the canonical patient. */
interface RemappedAppointment {
    id: string;
    calendarEventId?: string;
    status: Appointment["status"];
}

/**
 * Merge duplicate patients into their earliest-created canonical record.
 *
 * Three things have to happen together or the merge does not survive the next
 * Google Calendar pull, which is the whole reason this bug kept coming back:
 *
 *  - the removed id is tombstoned, or the pull re-adds the patient straight
 *    from the event's ptSchedulerPatientId metadata;
 *  - the remapped appointments go to syncStatus "pending", or a pull landing
 *    before the push reverts patientId and the push then writes it back;
 *  - an appointment "update" is queued, or the calendar event keeps the stale
 *    ptSchedulerPatientId forever.
 */
export async function dedupeLocalPatients(): Promise<LocalPatientDedupeResult> {
    const allPatients = await patientDB.getAll();
    const sortedPatients = [...allPatients].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const canonicalPatients: Patient[] = [];
    const removedPatientIds: string[] = [];
    const canonicalPatientIdsToResync = new Set<string>();

    for (const candidate of sortedPatients) {
        const duplicateOf = canonicalPatients.find(
            (canonical) =>
                canonical.id !== candidate.id &&
                arePatientsLikelyDuplicate(canonical, candidate)
        );

        if (!duplicateOf) {
            canonicalPatients.push(candidate);
            continue;
        }

        const mergedCanonical = mergePatientRecords(duplicateOf, candidate);
        const remappedAppointments: RemappedAppointment[] = [];

        await db.transaction("rw", db.patients, db.appointments, async () => {
            await db.patients.put(mergedCanonical);
            await db.appointments.where("patientId").equals(candidate.id).modify((appointment) => {
                appointment.patientId = mergedCanonical.id;
                // Blocks the calendar pull from reverting patientId before
                // the queued push below rewrites the event's metadata.
                appointment.syncStatus = "pending";
                appointment.updatedAt = new Date();
                remappedAppointments.push({
                    id: appointment.id,
                    calendarEventId: appointment.calendarEventId,
                    status: appointment.status,
                });
            });
            await db.patients.delete(candidate.id);
        });

        // After the transaction commits: a rolled-back merge must not leave
        // a tombstone or a queued push behind.
        trackDeletedPatientId(candidate.id);
        for (const appointment of remappedAppointments) {
            // No calendarEventId means the appointment isn't on the calendar,
            // so there is no stale ptSchedulerPatientId to rewrite.
            if (appointment.calendarEventId && appointment.status !== "cancelled") {
                await enqueueAppointmentSync("update", appointment.id);
            }
        }

        const canonicalIndex = canonicalPatients.findIndex(
            (patient) => patient.id === mergedCanonical.id
        );
        if (canonicalIndex >= 0) {
            canonicalPatients[canonicalIndex] = mergedCanonical;
        }

        removedPatientIds.push(candidate.id);
        canonicalPatientIdsToResync.add(mergedCanonical.id);
    }

    return {
        removedPatientIds,
        canonicalPatientIdsToResync: [...canonicalPatientIdsToResync],
    };
}
