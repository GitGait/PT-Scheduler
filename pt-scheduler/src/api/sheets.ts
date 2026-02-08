/**
 * Google Sheets API integration for patient sync.
 */

import { getAccessToken } from "./auth";
import type { Patient } from "../types";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const ALT_CONTACT_ENTRY_SEPARATOR = ";";
const ALT_CONTACT_PART_SEPARATOR = "|";

interface SheetValues {
    values: string[][];
}

type AlternateContact = Patient["alternateContacts"][number];

interface GoogleApiErrorPayload {
    error?: {
        code?: number;
        message?: string;
        status?: string;
    };
}

async function getSheetsErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const payload = (await response.json()) as GoogleApiErrorPayload;
        const message = payload.error?.message;
        if (message) {
            return `${fallback}: ${message}`;
        }
    } catch {
        // Ignore parse errors and use fallback
    }

    return fallback;
}

export function parseAlternateContactsField(value: string): AlternateContact[] {
    if (!value.trim()) {
        return [];
    }

    const contacts: AlternateContact[] = [];
    const entries = value
        .split(ALT_CONTACT_ENTRY_SEPARATOR)
        .map((entry) => entry.trim())
        .filter(Boolean);

    for (const entry of entries) {
        const [firstName = "", phone = "", relationship = ""] = entry
            .split(ALT_CONTACT_PART_SEPARATOR)
            .map((part) => part.trim());

        if (!firstName || !phone) {
            continue;
        }

        if (relationship) {
            contacts.push({ firstName, phone, relationship });
        } else {
            contacts.push({ firstName, phone });
        }
    }

    return contacts;
}

export function serializeAlternateContactsField(contacts: AlternateContact[]): string {
    return contacts
        .filter((contact) => contact.firstName.trim() && contact.phone.trim())
        .map((contact) => {
            const firstName = contact.firstName.trim();
            const phone = contact.phone.trim();
            const relationship = contact.relationship?.trim();
            return relationship
                ? `${firstName}${ALT_CONTACT_PART_SEPARATOR}${phone}${ALT_CONTACT_PART_SEPARATOR}${relationship}`
                : `${firstName}${ALT_CONTACT_PART_SEPARATOR}${phone}`;
        })
        .join(`${ALT_CONTACT_ENTRY_SEPARATOR} `);
}

/**
 * Fetch patients from the Patients tab of a Google Sheet.
 */
export async function fetchPatientsFromSheet(
    spreadsheetId: string,
    range = "Patients!A:J"
): Promise<Patient[]> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }

    const data: SheetValues = await response.json();
    const rows = data.values || [];

    if (rows.length < 2) {
        return []; // No data rows
    }

    // First row is headers
    const headers = rows[0];
    const patients: Patient[] = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const patient = parsePatientRow(headers, row);
        if (patient) {
            patients.push(patient);
        }
    }

    return patients;
}

/**
 * Upsert a patient to the Patients sheet.
 */
export async function upsertPatientToSheet(
    spreadsheetId: string,
    patient: Patient
): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    // Append the patient as a new row
    // In a real implementation, you'd search for existing row by ID first
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/Patients!A:J:append?valueInputOption=USER_ENTERED`;

    const values = [[
        patient.id,
        patient.fullName,
        patient.nicknames.join(", "),
        patient.phone,
        serializeAlternateContactsField(patient.alternateContacts),
        patient.address,
        patient.lat?.toString() || "",
        patient.lng?.toString() || "",
        patient.status,
        patient.notes || "",
    ]];

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
    });

    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }
}

/**
 * Parse a spreadsheet row into a Patient object.
 */
function parsePatientRow(headers: string[], row: string[]): Patient | null {
    const getValue = (header: string) => {
        const index = headers.findIndex((h) => h.toLowerCase() === header.toLowerCase());
        return index >= 0 ? row[index] || "" : "";
    };

    const id = getValue("id");
    const fullName = getValue("fullName") || getValue("name");

    if (!id || !fullName) {
        return null;
    }

    return {
        id,
        fullName,
        nicknames: getValue("nicknames").split(",").map((n) => n.trim()).filter(Boolean),
        phone: getValue("phone"),
        alternateContacts: parseAlternateContactsField(
            getValue("alternateContacts") || getValue("alternateContact")
        ),
        address: getValue("address"),
        lat: parseFloat(getValue("lat")) || undefined,
        lng: parseFloat(getValue("lng")) || undefined,
        email: getValue("email") || undefined,
        status: (getValue("status") as Patient["status"]) || "active",
        notes: getValue("notes"),
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}
