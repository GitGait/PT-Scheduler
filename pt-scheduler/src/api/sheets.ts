/**
 * Google Sheets API integration for patient sync.
 */

import { getAccessToken } from "./auth";
import { fetchWithTimeout } from "./request";
import type { Patient } from "../types";
import { sheetValuesSchema, spreadsheetMetadataSchema, parseWithSchema } from "../utils/validation";
import type { SpreadsheetMetadata } from "../utils/validation";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const ALT_CONTACT_ENTRY_SEPARATOR = ";";
const ALT_CONTACT_PART_SEPARATOR = "|";
const PATIENTS_SHEET_TITLE = "Patients";
const DISCHARGE_SHEET_TITLE = "Discharge";
const FOR_OTHER_PT_SHEET_TITLE = "For Other PT";

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
    range = `${PATIENTS_SHEET_TITLE}!A:K`
): Promise<Patient[]> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const allPatients = new Map<string, Patient>();

    const loadTabPatients = async (
        sheetTitle: string,
        forcedStatus?: Patient["status"]
    ): Promise<void> => {
        const rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, false);
        if (rows.length < 2) {
            return;
        }

        const headers = rows[0];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const patient = parsePatientRow(headers, row, forcedStatus);
            if (!patient) {
                continue;
            }

            const existing = allPatients.get(patient.id);
            if (!existing) {
                allPatients.set(patient.id, patient);
                continue;
            }

            // If duplicate appears across tabs, prefer discharged record.
            if (patient.status === "discharged" && existing.status !== "discharged") {
                allPatients.set(patient.id, patient);
            }
        }
    };

    if (range !== `${PATIENTS_SHEET_TITLE}!A:K`) {
        const rows = await fetchPatientSheetRows(spreadsheetId, token, range, false);
        if (rows.length < 2) {
            return [];
        }
        const headers = rows[0];
        for (let i = 1; i < rows.length; i++) {
            const patient = parsePatientRow(headers, rows[i]);
            if (patient) {
                allPatients.set(patient.id, patient);
            }
        }
        return [...allPatients.values()];
    }

    await loadTabPatients(PATIENTS_SHEET_TITLE);
    await loadTabPatients(DISCHARGE_SHEET_TITLE, "discharged");
    await loadTabPatients(FOR_OTHER_PT_SHEET_TITLE, "for-other-pt");

    return [...allPatients.values()];
}

/**
 * Upsert a patient to the Patients sheet.
 */
export async function upsertPatientToSheet(
    spreadsheetId: string,
    patient: Patient
): Promise<void> {
    await syncPatientToSheetByStatus(spreadsheetId, patient);
}

/**
 * Update a patient row in the Patients sheet by finding and updating the existing row.
 */
export async function updatePatientInSheet(
    spreadsheetId: string,
    patient: Patient
): Promise<void> {
    await syncPatientToSheetByStatus(spreadsheetId, patient);
}

/**
 * Upsert patient into status-appropriate tab and remove from the opposite tab.
 */
export async function syncPatientToSheetByStatus(
    spreadsheetId: string,
    patient: Patient
): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const allTabs = [PATIENTS_SHEET_TITLE, DISCHARGE_SHEET_TITLE, FOR_OTHER_PT_SHEET_TITLE];
    let targetTitle: string;
    if (patient.status === "discharged") {
        targetTitle = DISCHARGE_SHEET_TITLE;
    } else if (patient.status === "for-other-pt") {
        targetTitle = FOR_OTHER_PT_SHEET_TITLE;
    } else {
        targetTitle = PATIENTS_SHEET_TITLE;
    }

    await upsertPatientToNamedSheet(spreadsheetId, token, targetTitle, patient);
    for (const tab of allTabs) {
        if (tab !== targetTitle) {
            await deletePatientRowsByIdsInSheet(spreadsheetId, token, tab, [patient.id]);
        }
    }
}

/**
 * Delete all rows in Patients sheet whose ID column matches any of the provided patient IDs.
 * Returns number of rows removed.
 */
export async function deletePatientsFromSheetByIds(
    spreadsheetId: string,
    patientIds: string[]
): Promise<number> {
    const normalizedIds = new Set(
        patientIds.map((id) => id.trim()).filter(Boolean)
    );
    if (normalizedIds.size === 0) {
        return 0;
    }

    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const idList = [...normalizedIds];
    const removedFromPatients = await deletePatientRowsByIdsInSheet(
        spreadsheetId,
        token,
        PATIENTS_SHEET_TITLE,
        idList
    );
    const removedFromDischarge = await deletePatientRowsByIdsInSheet(
        spreadsheetId,
        token,
        DISCHARGE_SHEET_TITLE,
        idList
    );
    const removedFromForOtherPt = await deletePatientRowsByIdsInSheet(
        spreadsheetId,
        token,
        FOR_OTHER_PT_SHEET_TITLE,
        idList
    );
    return removedFromPatients + removedFromDischarge + removedFromForOtherPt;
}

/**
 * Remove duplicate rows from Patients sheet using ID/name/phone/address keys.
 * Returns number of rows removed.
 */
export async function removeDuplicatePatientRowsInSheet(
    spreadsheetId: string
): Promise<number> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error("Not authenticated");
    }

    const inPatients = await removeDuplicateRowsInSinglePatientSheet(
        spreadsheetId,
        token,
        PATIENTS_SHEET_TITLE
    );
    const inDischarge = await removeDuplicateRowsInSinglePatientSheet(
        spreadsheetId,
        token,
        DISCHARGE_SHEET_TITLE
    );
    const inForOtherPt = await removeDuplicateRowsInSinglePatientSheet(
        spreadsheetId,
        token,
        FOR_OTHER_PT_SHEET_TITLE
    );

    // If same ID exists in both tabs, keep discharged copy and remove active-tab copy.
    const dischargeIds = await getPatientIdsInSheet(spreadsheetId, token, DISCHARGE_SHEET_TITLE);
    const removedFromPatients = await deletePatientRowsByIdsInSheet(
        spreadsheetId,
        token,
        PATIENTS_SHEET_TITLE,
        [...dischargeIds]
    );

    // Also remove For Other PT IDs from the Patients tab.
    const forOtherPtIds = await getPatientIdsInSheet(spreadsheetId, token, FOR_OTHER_PT_SHEET_TITLE);
    const removedFromPatientsForOtherPt = await deletePatientRowsByIdsInSheet(
        spreadsheetId,
        token,
        PATIENTS_SHEET_TITLE,
        [...forOtherPtIds]
    );

    return inPatients + inDischarge + inForOtherPt + removedFromPatients + removedFromPatientsForOtherPt;
}

/**
 * Parse a spreadsheet row into a Patient object.
 */
function parsePatientRow(
    headers: string[],
    row: string[],
    forcedStatus?: Patient["status"]
): Patient | null {
    const getValue = (header: string) => {
        const index = headers.findIndex((h) => h.toLowerCase() === header.toLowerCase());
        return index >= 0 ? row[index] || "" : "";
    };

    const id = getValue("id");
    const fullName = getValue("fullName") || getValue("name");
    const parsedStatus = ((getValue("status") as Patient["status"]) || "active");

    if (!id || !fullName) {
        return null;
    }

    const forOtherPtAtRaw = getValue("forOtherPtAt");
    const forOtherPtAtDate = forOtherPtAtRaw ? new Date(forOtherPtAtRaw) : undefined;

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
        status: forcedStatus ?? parsedStatus,
        notes: getValue("notes"),
        forOtherPtAt: forOtherPtAtDate && !isNaN(forOtherPtAtDate.getTime()) ? forOtherPtAtDate : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function normalizeHeader(value: string): string {
    return value.replace(/\uFEFF/g, "").trim().toLowerCase();
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
    const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
    return headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
}

function normalizeNameForDedup(value: string): string {
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

function normalizePhoneForDedup(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
        return digits.slice(1);
    }
    return digits;
}

function normalizeAddressForDedup(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildSheetPatientDedupKeys(input: {
    id: string;
    fullName: string;
    phone: string;
    address: string;
}): string[] {
    const keys: string[] = [];
    const id = input.id.trim();
    const name = normalizeNameForDedup(input.fullName);
    const phone = normalizePhoneForDedup(input.phone);
    const address = normalizeAddressForDedup(input.address);

    if (id) {
        keys.push(`id:${id}`);
    }
    if (name && phone) {
        keys.push(`name_phone:${name}|${phone}`);
    }
    if (name && address) {
        keys.push(`name_address:${name}|${address}`);
    }
    if (name && (!phone || !address)) {
        keys.push(`name_partial:${name}`);
    }
    if (name && !phone && !address) {
        keys.push(`name_only:${name}`);
    }

    return keys;
}

const DEFAULT_PATIENT_HEADERS = [
    "id",
    "fullName",
    "nicknames",
    "phone",
    "alternateContacts",
    "address",
    "lat",
    "lng",
    "status",
    "notes",
    "forOtherPtAt",
];

async function upsertPatientToNamedSheet(
    spreadsheetId: string,
    token: string,
    sheetTitle: string,
    patient: Patient
): Promise<void> {
    await ensurePatientSheetExists(spreadsheetId, token, sheetTitle);
    let rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, true);
    if (rows.length === 0) {
        await ensurePatientSheetHeaders(spreadsheetId, token, sheetTitle);
        rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, true);
    }

    const headers = rows[0] ?? DEFAULT_PATIENT_HEADERS;
    let idIndex = findHeaderIndex(headers, ["id"]);
    if (idIndex < 0) {
        await ensurePatientSheetHeaders(spreadsheetId, token, sheetTitle);
        rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, true);
        idIndex = findHeaderIndex(rows[0] ?? DEFAULT_PATIENT_HEADERS, ["id"]);
        if (idIndex < 0) {
            throw new Error(`ID column not found in ${sheetTitle} sheet`);
        }
    }

    const effectiveHeaders = rows[0] ?? DEFAULT_PATIENT_HEADERS;
    const rowValues = buildPatientRowForHeaders(effectiveHeaders, patient);

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if ((rows[i][idIndex] ?? "").trim() === patient.id) {
            rowIndex = i + 1;
            break;
        }
    }

    if (rowIndex >= 0) {
        const endCol = toColumnLetter(Math.max(effectiveHeaders.length, DEFAULT_PATIENT_HEADERS.length));
        const updateUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(
            `${sheetTitle}!A${rowIndex}:${endCol}${rowIndex}`
        )}?valueInputOption=USER_ENTERED`;
        const updateResponse = await fetchWithTimeout(updateUrl, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: [rowValues] }),
        });
        if (!updateResponse.ok) {
            const fallback = `Sheets API error (${updateResponse.status})`;
            throw new Error(await getSheetsErrorMessage(updateResponse, fallback));
        }
        return;
    }

    const appendUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(
        `${sheetTitle}!A:${toColumnLetter(Math.max(effectiveHeaders.length, DEFAULT_PATIENT_HEADERS.length))}`
    )}:append?valueInputOption=USER_ENTERED`;
    const appendResponse = await fetchWithTimeout(appendUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [rowValues] }),
    });
    if (!appendResponse.ok) {
        const fallback = `Sheets API error (${appendResponse.status})`;
        throw new Error(await getSheetsErrorMessage(appendResponse, fallback));
    }
}

async function deletePatientRowsByIdsInSheet(
    spreadsheetId: string,
    token: string,
    sheetTitle: string,
    patientIds: string[]
): Promise<number> {
    const normalizedIds = new Set(patientIds.map((id) => id.trim()).filter(Boolean));
    if (normalizedIds.size === 0) {
        return 0;
    }

    const rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, false);
    if (rows.length < 2) {
        return 0;
    }

    const headers = rows[0];
    const idIndex = findHeaderIndex(headers, ["id"]);
    if (idIndex < 0) {
        return 0;
    }

    const rowIndicesToDelete: number[] = [];
    for (let i = 1; i < rows.length; i++) {
        const patientId = (rows[i][idIndex] ?? "").trim();
        if (patientId && normalizedIds.has(patientId)) {
            rowIndicesToDelete.push(i + 1);
        }
    }

    try {
        await deletePatientSheetRows(spreadsheetId, token, sheetTitle, rowIndicesToDelete);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to delete ${rowIndicesToDelete.length} rows from ${sheetTitle}:`, err);
        throw new Error(`Failed to delete rows from ${sheetTitle}: ${message}. Some rows may have been deleted.`);
    }

    return rowIndicesToDelete.length;
}

async function removeDuplicateRowsInSinglePatientSheet(
    spreadsheetId: string,
    token: string,
    sheetTitle: string
): Promise<number> {
    const rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, false);
    if (rows.length < 2) {
        return 0;
    }

    const headers = rows[0];
    const idIndex = findHeaderIndex(headers, ["id"]);
    const nameIndex = findHeaderIndex(headers, ["fullname", "name"]);
    const phoneIndex = findHeaderIndex(headers, ["phone", "phonenumber"]);
    const addressIndex = findHeaderIndex(headers, ["address", "homeaddress", "streetaddress"]);

    const seenKeys = new Set<string>();
    const rowIndicesToDelete: number[] = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const keys = buildSheetPatientDedupKeys({
            id: idIndex >= 0 ? row[idIndex] ?? "" : "",
            fullName: nameIndex >= 0 ? row[nameIndex] ?? "" : "",
            phone: phoneIndex >= 0 ? row[phoneIndex] ?? "" : "",
            address: addressIndex >= 0 ? row[addressIndex] ?? "" : "",
        });
        if (keys.length === 0) {
            continue;
        }

        const isDuplicate = keys.some((key) => seenKeys.has(key));
        if (isDuplicate) {
            rowIndicesToDelete.push(i + 1);
            continue;
        }

        for (const key of keys) {
            seenKeys.add(key);
        }
    }

    await deletePatientSheetRows(spreadsheetId, token, sheetTitle, rowIndicesToDelete);
    return rowIndicesToDelete.length;
}

async function getPatientIdsInSheet(
    spreadsheetId: string,
    token: string,
    sheetTitle: string
): Promise<Set<string>> {
    const rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, false);
    if (rows.length < 2) {
        return new Set<string>();
    }

    const headers = rows[0];
    const idIndex = findHeaderIndex(headers, ["id"]);
    if (idIndex < 0) {
        return new Set<string>();
    }

    const ids = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
        const id = (rows[i][idIndex] ?? "").trim();
        if (id) {
            ids.add(id);
        }
    }
    return ids;
}

function buildPatientRowForHeaders(headers: string[], patient: Patient): string[] {
    const normalizedHeaders = headers.length > 0 ? headers : DEFAULT_PATIENT_HEADERS;
    const row = new Array(normalizedHeaders.length).fill("");

    const setCell = (aliases: string[], value: string) => {
        const index = findHeaderIndex(normalizedHeaders, aliases);
        if (index >= 0) {
            row[index] = value;
        }
    };

    setCell(["id"], patient.id);
    setCell(["fullname", "name"], patient.fullName);
    setCell(["nicknames"], patient.nicknames.join(", "));
    setCell(["phone", "phonenumber"], patient.phone);
    setCell(["alternatecontacts", "alternatecontact"], serializeAlternateContactsField(patient.alternateContacts));
    setCell(["address"], patient.address);
    setCell(["lat", "latitude"], patient.lat?.toString() || "");
    setCell(["lng", "longitude", "long"], patient.lng?.toString() || "");
    setCell(["status"], patient.status);
    setCell(["notes"], patient.notes || "");
    setCell(["email"], patient.email || "");
    setCell(["forotherptat"], patient.forOtherPtAt ? patient.forOtherPtAt.toISOString() : "");

    return row;
}

async function ensurePatientSheetExists(
    spreadsheetId: string,
    token: string,
    sheetTitle: string
): Promise<void> {
    await getSheetIdByTitle(spreadsheetId, token, sheetTitle, true);
}

async function ensurePatientSheetHeaders(
    spreadsheetId: string,
    token: string,
    sheetTitle: string
): Promise<void> {
    const rows = await fetchPatientSheetRows(spreadsheetId, token, sheetTitle, false);
    if (rows.length > 0 && rows[0].some((cell) => cell.trim() !== "")) {
        return;
    }

    const writeUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(
        `${sheetTitle}!A1:${toColumnLetter(DEFAULT_PATIENT_HEADERS.length)}1`
    )}?valueInputOption=USER_ENTERED`;
    const response = await fetchWithTimeout(writeUrl, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [DEFAULT_PATIENT_HEADERS] }),
    });

    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }
}

async function fetchPatientSheetRows(
    spreadsheetId: string,
    token: string,
    sheetOrRange: string,
    throwIfMissing = true
): Promise<string[][]> {
    const range = sheetOrRange.includes("!") ? sheetOrRange : `${sheetOrRange}!A:K`;
    const fetchUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const response = await fetchWithTimeout(fetchUrl, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        if (!throwIfMissing && (response.status === 400 || response.status === 404)) {
            return [];
        }
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }

    const raw = await response.json();
    const payload = parseWithSchema(sheetValuesSchema, raw, "Sheets values response");
    return payload.values;
}

async function getSheetIdByTitle(
    spreadsheetId: string,
    token: string,
    sheetTitle: string,
    createIfMissing = false
): Promise<number | null> {
    const metadata = await fetchSpreadsheetMetadata(spreadsheetId, token);
    const existing = metadata.sheets?.find((sheet) => sheet.properties?.title === sheetTitle);
    const existingId = existing?.properties?.sheetId;
    if (typeof existingId === "number") {
        return existingId;
    }

    if (!createIfMissing) {
        return null;
    }

    const response = await fetchWithTimeout(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            requests: [{ addSheet: { properties: { title: sheetTitle } } }],
        }),
    });
    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }

    const refreshed = await fetchSpreadsheetMetadata(spreadsheetId, token);
    const created = refreshed.sheets?.find((sheet) => sheet.properties?.title === sheetTitle);
    const createdId = created?.properties?.sheetId;
    if (typeof createdId !== "number") {
        throw new Error(`Failed to create ${sheetTitle} sheet`);
    }
    return createdId;
}

async function fetchSpreadsheetMetadata(
    spreadsheetId: string,
    token: string
): Promise<SpreadsheetMetadata> {
    const metadataUrl = `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
    const response = await fetchWithTimeout(metadataUrl, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }

    const raw = await response.json();
    return parseWithSchema(spreadsheetMetadataSchema, raw, "Spreadsheet metadata response");
}

async function deletePatientSheetRows(
    spreadsheetId: string,
    token: string,
    sheetTitle: string,
    rowIndices1Based: number[]
): Promise<void> {
    if (rowIndices1Based.length === 0) {
        return;
    }

    const sheetId = await getSheetIdByTitle(spreadsheetId, token, sheetTitle, false);
    if (sheetId === null) {
        return;
    }

    const requests = [...rowIndices1Based]
        .sort((a, b) => b - a)
        .map((rowIndex) => ({
            deleteDimension: {
                range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: rowIndex - 1,
                    endIndex: rowIndex,
                },
            },
        }));

    const response = await fetchWithTimeout(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
    }, 60_000);

    if (!response.ok) {
        const fallback = `Sheets API error (${response.status})`;
        throw new Error(await getSheetsErrorMessage(response, fallback));
    }
}

function toColumnLetter(index1Based: number): string {
    let n = Math.max(1, index1Based);
    let result = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        n = Math.floor((n - 1) / 26);
    }
    return result;
}
