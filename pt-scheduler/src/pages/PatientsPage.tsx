import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePatientStore, useSyncStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PatientListSkeleton } from "../components/ui/Skeleton";
import { PatientsEmptyState, SearchEmptyState } from "../components/ui/EmptyState";
import { mapCsvColumns } from "../api/csvMapping";
import { extractPatient } from "../api/extract";
import { isSignedIn } from "../api/auth";
import {
    deletePatientsFromSheetByIds,
    parseAlternateContactsField,
    removeDuplicatePatientRowsInSheet,
    serializeAlternateContactsField,
    syncPatientToSheetByStatus,
} from "../api/sheets";
import { db } from "../db/schema";
import { patientDB, syncQueueDB } from "../db/operations";
import { Search, Phone, X, Plus, Navigation } from "lucide-react";
import type { Patient, PatientStatus } from "../types";
import type { CSVColumnMapping } from "../utils/validation";

interface PatientFormData {
    fullName: string;
    nicknames: string;
    phone: string;
    address: string;
    email: string;
    alternateContacts: string;
    notes: string;
    status: PatientStatus;
}

const emptyForm: PatientFormData = {
    fullName: "",
    nicknames: "",
    phone: "",
    address: "",
    email: "",
    alternateContacts: "",
    notes: "",
    status: "active",
};

const DUPLICATE_CLEANUP_STATUS_STORAGE_KEY = "ptScheduler.lastDuplicateCleanupStatus";

interface DuplicateCleanupStatus {
    completedAt: string;
    localRemoved: number;
    sheetRemoved: number;
    queuedActions: number;
    sheetSyncSummary: string;
}

function loadDuplicateCleanupStatus(): DuplicateCleanupStatus | null {
    if (typeof window === "undefined") {
        return null;
    }

    const raw = window.localStorage.getItem(DUPLICATE_CLEANUP_STATUS_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<DuplicateCleanupStatus>;
        if (
            typeof parsed.completedAt === "string" &&
            typeof parsed.localRemoved === "number" &&
            typeof parsed.sheetRemoved === "number" &&
            typeof parsed.queuedActions === "number" &&
            typeof parsed.sheetSyncSummary === "string"
        ) {
            return parsed as DuplicateCleanupStatus;
        }
    } catch {
        // Ignore parse errors and treat as no status.
    }

    return null;
}

function saveDuplicateCleanupStatus(status: DuplicateCleanupStatus): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(
        DUPLICATE_CLEANUP_STATUS_STORAGE_KEY,
        JSON.stringify(status)
    );
}

function formatCleanupStatusTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleString();
}

/**
 * Sanitize a CSV cell value by removing control characters that could cause issues.
 * Preserves normal whitespace (space, tab) but removes null bytes and other control chars.
 */
function sanitizeCsvCell(value: string): string {
    // Remove null bytes and other control characters (except tab, newline, carriage return)
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function parseCsv(content: string): string[][] {
    const lines = content
        .split(/\r\n|\n|\r/)
        .map((line) => line.trim())
        .filter(Boolean);

    const headerLine = lines[0] ?? "";
    const candidates = [",", ";", "\t", "|"] as const;
    const delimiterScores = candidates.map((delimiter) => ({
        delimiter,
        score: headerLine.split(delimiter).length,
    }));
    const delimiter =
        delimiterScores.sort((a, b) => b.score - a.score)[0]?.delimiter ?? ",";

    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < content.length; i += 1) {
        const ch = content[i];

        if (ch === "\"") {
            if (inQuotes && content[i + 1] === "\"") {
                cell += "\"";
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === delimiter && !inQuotes) {
            row.push(sanitizeCsvCell(cell));
            cell = "";
            continue;
        }

        if ((ch === "\n" || ch === "\r") && !inQuotes) {
            if (ch === "\r" && content[i + 1] === "\n") {
                i += 1;
            }
            row.push(sanitizeCsvCell(cell));
            cell = "";

            if (row.some((value) => value.trim() !== "")) {
                rows.push(row);
            }
            row = [];
            continue;
        }

        cell += ch;
    }

    row.push(sanitizeCsvCell(cell));
    if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
    }

    return rows;
}

function normalizeHeader(value: string): string {
    return value.replace(/\uFEFF/g, "").trim().toLowerCase();
}

const CSV_TARGET_FIELDS = [
    { key: "id", label: "Patient ID" },
    { key: "fullName", label: "Full Name", required: true },
    { key: "nicknames", label: "Nicknames" },
    { key: "phone", label: "Phone" },
    { key: "alternateContacts", label: "Alternate Contacts" },
    { key: "address", label: "Address" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "status", label: "Status" },
    { key: "notes", label: "Notes" },
    { key: "email", label: "Email" },
] as const;

type CsvTargetField = (typeof CSV_TARGET_FIELDS)[number]["key"];
type CsvColumnMappingState = Record<CsvTargetField, string | null>;

interface CsvImportPayload {
    headers: string[];
    rows: string[][];
    fileName: string;
}

const EMPTY_CSV_MAPPING: CsvColumnMappingState = {
    id: null,
    fullName: null,
    nicknames: null,
    phone: null,
    alternateContacts: null,
    address: null,
    lat: null,
    lng: null,
    status: null,
    notes: null,
    email: null,
};

function toCsvMappingState(mapping?: Partial<CSVColumnMapping> | null): CsvColumnMappingState {
    return {
        id: mapping?.id ?? null,
        fullName: mapping?.fullName ?? null,
        nicknames: mapping?.nicknames ?? null,
        phone: mapping?.phone ?? null,
        alternateContacts: mapping?.alternateContacts ?? null,
        address: mapping?.address ?? null,
        lat: mapping?.lat ?? null,
        lng: mapping?.lng ?? null,
        status: mapping?.status ?? null,
        notes: mapping?.notes ?? null,
        email: mapping?.email ?? null,
    };
}

function guessCsvMapping(headers: string[]): CsvColumnMappingState {
    const aliases: Record<CsvTargetField, string[]> = {
        id: ["id", "patientid", "patient_id", "clientid", "client_id", "mrn"],
        fullName: ["fullname", "full_name", "name", "patientname", "patient_name", "clientname"],
        nicknames: ["nicknames", "nickname", "alias", "preferredname", "preferred_name"],
        phone: ["phone", "phonenumber", "phone_number", "mobile", "cell"],
        alternateContacts: ["alternatecontacts", "alternate_contact", "emergencycontact", "contact"],
        address: ["address", "homeaddress", "streetaddress", "location"],
        lat: ["lat", "latitude"],
        lng: ["lng", "long", "longitude"],
        status: ["status", "patientstatus", "state"],
        notes: ["notes", "note", "comments", "comment"],
        email: ["email", "emailaddress", "email_address"],
    };

    const byNormalized = new Map<string, string>();
    for (const header of headers) {
        byNormalized.set(normalizeHeader(header).replace(/[^a-z0-9]/g, ""), header);
    }

    const mapping = { ...EMPTY_CSV_MAPPING };
    for (const field of CSV_TARGET_FIELDS) {
        const candidates = aliases[field.key];
        for (const alias of candidates) {
            const match = byNormalized.get(alias);
            if (match) {
                mapping[field.key] = match;
                break;
            }
        }
    }
    return mapping;
}

function parsePatientStatus(value: string): PatientStatus {
    const normalized = value.trim().toLowerCase();
    if (normalized === "discharged") return "discharged";
    if (normalized === "evaluation") return "evaluation";
    return "active";
}

interface CsvParsedPatient {
    id?: string;
    fullName: string;
    nicknames: string[];
    phone: string;
    alternateContacts: Patient["alternateContacts"];
    address: string;
    lat?: number;
    lng?: number;
    email?: string;
    status: PatientStatus;
    notes: string;
}

interface PatientIdentityLike {
    id?: string;
    fullName: string;
    phone: string;
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

function buildPatientDedupKeys(patient: PatientIdentityLike): string[] {
    const keys: string[] = [];
    const id = normalizeIdentifier(patient.id);
    const name = normalizePersonName(patient.fullName);
    const phone = normalizePhoneForMatch(patient.phone);
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
    if (name && (!phone || !address)) {
        keys.push(`name_partial:${name}`);
    }
    if (name && !phone && !address) {
        keys.push(`name_only:${name}`);
    }

    return keys;
}

function parsePatientRowFromCsv(
    headers: string[],
    row: string[],
    mapping: CsvColumnMappingState
): CsvParsedPatient | null {
    const indexByHeader = new Map<string, number>();
    headers.forEach((header, index) => {
        indexByHeader.set(normalizeHeader(header), index);
    });

    const getMappedValue = (field: CsvTargetField): string => {
        const sourceHeader = mapping[field];
        if (!sourceHeader) {
            return "";
        }
        const idx = indexByHeader.get(normalizeHeader(sourceHeader));
        if (idx === undefined) {
            return "";
        }
        return (row[idx] ?? "").trim();
    };

    const fullName = getMappedValue("fullName");
    if (!fullName) {
        return null;
    }

    const latRaw = getMappedValue("lat");
    const lngRaw = getMappedValue("lng");
    const lat = latRaw ? Number(latRaw) : undefined;
    const lng = lngRaw ? Number(lngRaw) : undefined;
    const email = getMappedValue("email");
    const notesBase = getMappedValue("notes");
    const notes = [notesBase, email ? `Email: ${email}` : ""].filter(Boolean).join("\n");

    return {
        id: getMappedValue("id") || undefined,
        fullName,
        nicknames: getMappedValue("nicknames")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
        phone: getMappedValue("phone"),
        alternateContacts: parseAlternateContactsField(getMappedValue("alternateContacts")),
        address: getMappedValue("address"),
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        email: email || undefined,
        status: parsePatientStatus(getMappedValue("status")),
        notes,
    };
}

function isLikelyHeaderRow(row: string[]): boolean {
    const nonEmpty = row.map((value) => value.trim()).filter(Boolean);
    if (nonEmpty.length === 0) {
        return false;
    }

    let headerLike = 0;
    for (const cell of nonEmpty) {
        const noDigits = !/\d/.test(cell);
        const alphaish = /^[a-zA-Z _-]+$/.test(cell);
        const short = cell.length <= 40;
        if (noDigits && alphaish && short) {
            headerLike += 1;
        }
    }

    return headerLike >= Math.ceil(nonEmpty.length * 0.6);
}

function detectUnstructuredCsvColumns(rows: string[][]): {
    textIndex: number;
    cityIndex: number | null;
} {
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (columnCount <= 1) {
        return { textIndex: 0, cityIndex: null };
    }

    const stats = Array.from({ length: columnCount }, (_, columnIndex) => {
        const values = rows.map((row) => (row[columnIndex] ?? "").trim()).filter(Boolean);
        const totalLength = values.reduce((sum, value) => sum + value.length, 0);
        const avgLength = values.length > 0 ? totalLength / values.length : 0;
        const digitRatio =
            values.length > 0
                ? values.filter((value) => /\d/.test(value)).length / values.length
                : 0;
        const uniqueCount = new Set(values.map((value) => value.toLowerCase())).size;

        return {
            columnIndex,
            avgLength,
            digitRatio,
            uniqueCount,
        };
    });

    const textIndex =
        [...stats]
            .sort((a, b) => b.avgLength + b.digitRatio * 20 - (a.avgLength + a.digitRatio * 20))[0]
            ?.columnIndex ?? 0;

    const cityCandidate = stats
        .filter((entry) => entry.columnIndex !== textIndex)
        .map((entry) => {
            let score = 0;
            if (entry.digitRatio < 0.1) score += 20;
            if (entry.avgLength > 1 && entry.avgLength < 30) score += 10;
            if (entry.uniqueCount <= Math.max(5, Math.ceil(rows.length / 2))) score += 10;
            score -= entry.avgLength / 5;
            return { ...entry, score };
        })
        .sort((a, b) => b.score - a.score)[0];

    return {
        textIndex,
        cityIndex: cityCandidate && cityCandidate.score >= 15 ? cityCandidate.columnIndex : null,
    };
}

function inferNameFromUnstructuredText(raw: string): string {
    const cleaned = raw.trim().replace(/^["']|["']$/g, "");
    const beforePhone = cleaned.split(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/)[0]?.trim() ?? cleaned;
    const nameMatch = beforePhone.match(/[A-Za-z]+(?:\s+[A-Za-z]+){1,3}/);
    return nameMatch ? nameMatch[0].trim() : "";
}

function inferPhoneFromUnstructuredText(raw: string): string {
    const match = raw.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    return match ? match[0].trim() : "";
}

function mergeAddressWithCity(address: string, city: string): string {
    const normalizedAddress = address.trim();
    const normalizedCity = city.trim();

    if (!normalizedAddress) {
        return normalizedCity;
    }
    if (!normalizedCity) {
        return normalizedAddress;
    }
    if (normalizedAddress.toLowerCase().includes(normalizedCity.toLowerCase())) {
        return normalizedAddress;
    }

    return `${normalizedAddress}, ${normalizedCity}`;
}

interface LocalPatientDedupeResult {
    removedPatientIds: string[];
    canonicalPatientIdsToResync: string[];
}

function arePatientsLikelyDuplicate(a: PatientIdentityLike, b: PatientIdentityLike): boolean {
    const keysA = buildPatientDedupKeys(a).filter((key) => !key.startsWith("id:"));
    const keysB = new Set(buildPatientDedupKeys(b).filter((key) => !key.startsWith("id:")));
    return keysA.some((key) => keysB.has(key));
}

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

function mergePatientRecords(primary: Patient, duplicate: Patient): Patient {
    const now = new Date();
    const preferredName =
        primary.fullName.trim().length >= duplicate.fullName.trim().length
            ? primary.fullName
            : duplicate.fullName;

    return {
        ...primary,
        fullName: preferredName.trim() || primary.fullName,
        nicknames: mergeNicknames(primary.nicknames, duplicate.nicknames),
        phone: mergeStringValue(primary.phone, duplicate.phone),
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

export function PatientsPage() {
    const { patients, loadAll, search, loading, add } = usePatientStore();
    const { spreadsheetId, refreshPendingCount } = useSyncStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [showDischarged, setShowDischarged] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [formData, setFormData] = useState<PatientFormData>(emptyForm);
    const [formError, setFormError] = useState<string | null>(null);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveWarning, setSaveWarning] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [intakeText, setIntakeText] = useState("");
    const [isExtracting, setIsExtracting] = useState(false);
    const [isCsvDragging, setIsCsvDragging] = useState(false);
    const [isImportingCsv, setIsImportingCsv] = useState(false);
    const [isMappingCsv, setIsMappingCsv] = useState(false);
    const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
    const [showCsvMappingModal, setShowCsvMappingModal] = useState(false);
    const [csvImportPayload, setCsvImportPayload] = useState<CsvImportPayload | null>(null);
    const [csvMapping, setCsvMapping] = useState<CsvColumnMappingState>({
        ...EMPTY_CSV_MAPPING,
    });
    const [csvMappingConfidence, setCsvMappingConfidence] = useState<Record<string, number>>({});
    const [csvMappingError, setCsvMappingError] = useState<string | null>(null);
    const [duplicateCleanupStatus, setDuplicateCleanupStatus] =
        useState<DuplicateCleanupStatus | null>(() => loadDuplicateCleanupStatus());

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    useEffect(() => {
        if (searchQuery.trim()) {
            search(searchQuery);
        } else {
            loadAll();
        }
    }, [searchQuery, search, loadAll]);

    const filteredPatients = patients
        .filter((p) => showDischarged ? p.status === "discharged" : p.status !== "discharged")
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const handleOpenAdd = () => {
        setFormData(emptyForm);
        setFormError(null);
        setIntakeText("");
        setIsAddOpen(true);
    };

    const handleCloseAdd = () => {
        setFormError(null);
        setIntakeText("");
        setIsAddOpen(false);
    };

    const handleInputChange = (field: keyof PatientFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const recordDuplicateCleanupStatus = (params: {
        localRemoved: number;
        sheetRemoved: number;
        queuedActions: number;
        hasSpreadsheetId: boolean;
        canSyncNow: boolean;
    }) => {
        const { localRemoved, sheetRemoved, queuedActions, hasSpreadsheetId, canSyncNow } = params;

        let sheetSyncSummary = "No Spreadsheet ID configured (local cleanup only).";
        if (hasSpreadsheetId) {
            if (!canSyncNow) {
                sheetSyncSummary =
                    queuedActions > 0
                        ? "Cleanup actions queued for Google Sheets."
                        : "Google Sheets not available during this cleanup run.";
            } else if (queuedActions > 0) {
                sheetSyncSummary =
                    "Partially synced to Google Sheets; remaining cleanup actions queued.";
            } else {
                sheetSyncSummary = "Synced to Google Sheets.";
            }
        }

        const status: DuplicateCleanupStatus = {
            completedAt: new Date().toISOString(),
            localRemoved,
            sheetRemoved,
            queuedActions,
            sheetSyncSummary,
        };
        setDuplicateCleanupStatus(status);
        saveDuplicateCleanupStatus(status);
    };

    const queuePatientSheetsSync = async (patientId: string, refresh = true) => {
        await syncQueueDB.add({
            type: "create",
            entity: "patient",
            data: { entityId: patientId },
        });
        if (refresh) {
            await refreshPendingCount();
        }
    };

    const queuePatientDeleteSheetsSync = async (patientId: string, refresh = true) => {
        await syncQueueDB.add({
            type: "delete",
            entity: "patient",
            data: { entityId: patientId },
        });
        if (refresh) {
            await refreshPendingCount();
        }
    };

    const syncPatientToSheets = async (targetSpreadsheetId: string, patient: Patient) => {
        await syncPatientToSheetByStatus(targetSpreadsheetId, patient);
    };

    const dedupeLocalPatients = async (): Promise<LocalPatientDedupeResult> => {
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

            await db.transaction("rw", db.patients, db.appointments, async () => {
                await db.patients.put(mergedCanonical);
                await db.appointments.where("patientId").equals(candidate.id).modify((appointment) => {
                    appointment.patientId = mergedCanonical.id;
                    appointment.updatedAt = new Date();
                });
                await db.patients.delete(candidate.id);
            });

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
    };

    const persistParsedPatients = async (
        parsedRows: CsvParsedPatient[],
        fileName: string,
        skippedBase = 0,
        extraWarnings: string[] = []
    ) => {
        const targetSpreadsheetId = spreadsheetId.trim();
        const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        const canSyncNow = Boolean(targetSpreadsheetId && isSignedIn() && isOnline);
        const warnings = [...extraWarnings];

        let skipped = skippedBase;
        let imported = 0;
        let created = 0;
        let updated = 0;
        let syncedNow = 0;
        let queued = 0;
        let duplicateSkipped = 0;
        let localDuplicatesRemoved = 0;
        let sheetRowsRemovedById = 0;
        let sheetDuplicateRowsRemoved = 0;
        let cleanupQueuedActions = 0;

        const idCounts = new Map<string, number>();
        for (const parsed of parsedRows) {
            const normalizedId = normalizeIdentifier(parsed.id);
            if (normalizedId) {
                idCounts.set(normalizedId, (idCounts.get(normalizedId) ?? 0) + 1);
            }
        }

        const duplicateIds = [...idCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([id]) => id);
        if (duplicateIds.length > 0) {
            warnings.push(
                `${duplicateIds.length} duplicate ID value${
                    duplicateIds.length === 1 ? "" : "s"
                } detected in CSV. Only the first row for each ID will be imported.`
            );
        }

        const localPatients = await patientDB.getAll();
        const existingById = new Map<string, Patient>();
        const existingDedupKeys = new Set<string>();
        for (const localPatient of localPatients) {
            const localId = normalizeIdentifier(localPatient.id);
            if (localId) {
                existingById.set(localId, localPatient);
            }
            const keys = buildPatientDedupKeys({
                id: localPatient.id,
                fullName: localPatient.fullName,
                phone: localPatient.phone,
                address: localPatient.address,
            });
            for (const key of keys) {
                existingDedupKeys.add(key);
            }
        }

        const batchDedupKeys = new Set<string>();
        const processedIds = new Set<string>();

        for (const parsed of parsedRows) {
            let storedPatient: Patient | undefined;
            const normalizedId = normalizeIdentifier(parsed.id);
            if (normalizedId && processedIds.has(normalizedId)) {
                duplicateSkipped += 1;
                continue;
            }
            if (normalizedId) {
                processedIds.add(normalizedId);
            }

            const parsedDedupKeys = buildPatientDedupKeys(parsed);
            const existingWithSameId = normalizedId ? existingById.get(normalizedId) : undefined;
            const duplicateInBatch = parsedDedupKeys.some((key) => batchDedupKeys.has(key));
            const duplicateAgainstExisting =
                !existingWithSameId && parsedDedupKeys.some((key) => existingDedupKeys.has(key));
            if (duplicateInBatch || duplicateAgainstExisting) {
                duplicateSkipped += 1;
                continue;
            }

            for (const key of parsedDedupKeys) {
                batchDedupKeys.add(key);
            }

            if (normalizedId) {
                const existing = existingWithSameId ?? (await patientDB.get(normalizedId));
                const now = new Date();
                storedPatient = {
                    id: normalizedId,
                    fullName: parsed.fullName,
                    nicknames: parsed.nicknames,
                    phone: parsed.phone,
                    alternateContacts: parsed.alternateContacts,
                    address: parsed.address,
                    lat: parsed.lat,
                    lng: parsed.lng,
                    email: parsed.email,
                    status: parsed.status,
                    notes: parsed.notes,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                };
                await patientDB.upsert(storedPatient);
                if (existing) {
                    updated += 1;
                } else {
                    created += 1;
                }
                existingById.set(normalizedId, storedPatient);
            } else {
                const createdId = await add({
                    fullName: parsed.fullName,
                    nicknames: parsed.nicknames,
                    phone: parsed.phone,
                    alternateContacts: parsed.alternateContacts,
                    address: parsed.address,
                    lat: parsed.lat,
                    lng: parsed.lng,
                    email: parsed.email,
                    status: parsed.status,
                    notes: parsed.notes,
                });
                storedPatient = await patientDB.get(createdId);
                created += 1;
                if (storedPatient) {
                    const keys = buildPatientDedupKeys({
                        id: storedPatient.id,
                        fullName: storedPatient.fullName,
                        phone: storedPatient.phone,
                        address: storedPatient.address,
                    });
                    for (const key of keys) {
                        existingDedupKeys.add(key);
                    }
                }
            }

            if (!storedPatient) {
                skipped += 1;
                continue;
            }

            const storedKeys = buildPatientDedupKeys({
                id: storedPatient.id,
                fullName: storedPatient.fullName,
                phone: storedPatient.phone,
                address: storedPatient.address,
            });
            for (const key of storedKeys) {
                existingDedupKeys.add(key);
                batchDedupKeys.add(key);
            }

            imported += 1;

            if (!targetSpreadsheetId) {
                continue;
            }

            if (canSyncNow) {
                try {
                    await syncPatientToSheets(targetSpreadsheetId, storedPatient);
                    syncedNow += 1;
                } catch {
                    await queuePatientSheetsSync(storedPatient.id, false);
                    queued += 1;
                }
            } else {
                await queuePatientSheetsSync(storedPatient.id, false);
                queued += 1;
            }
        }

        const dedupeResult = await dedupeLocalPatients();
        localDuplicatesRemoved = dedupeResult.removedPatientIds.length;

        if (targetSpreadsheetId && localDuplicatesRemoved > 0) {
            if (canSyncNow) {
                const patientsToResync = dedupeResult.canonicalPatientIdsToResync;
                for (const canonicalId of patientsToResync) {
                    const canonicalPatient = await patientDB.get(canonicalId);
                    if (!canonicalPatient) {
                        continue;
                    }
                    try {
                        await syncPatientToSheets(targetSpreadsheetId, canonicalPatient);
                        syncedNow += 1;
                    } catch {
                        await queuePatientSheetsSync(canonicalPatient.id, false);
                        queued += 1;
                        cleanupQueuedActions += 1;
                    }
                }

                try {
                    sheetRowsRemovedById = await deletePatientsFromSheetByIds(
                        targetSpreadsheetId,
                        dedupeResult.removedPatientIds
                    );
                } catch {
                    for (const removedId of dedupeResult.removedPatientIds) {
                        await queuePatientDeleteSheetsSync(removedId, false);
                        queued += 1;
                        cleanupQueuedActions += 1;
                    }
                }

                try {
                    sheetDuplicateRowsRemoved = await removeDuplicatePatientRowsInSheet(
                        targetSpreadsheetId
                    );
                } catch {
                    warnings.push("Could not remove duplicate rows from Google Sheets in this run.");
                }
            } else {
                for (const canonicalId of dedupeResult.canonicalPatientIdsToResync) {
                    await queuePatientSheetsSync(canonicalId, false);
                    queued += 1;
                    cleanupQueuedActions += 1;
                }
                for (const removedId of dedupeResult.removedPatientIds) {
                    await queuePatientDeleteSheetsSync(removedId, false);
                    queued += 1;
                    cleanupQueuedActions += 1;
                }
            }
        } else if (targetSpreadsheetId && canSyncNow) {
            try {
                sheetDuplicateRowsRemoved = await removeDuplicatePatientRowsInSheet(targetSpreadsheetId);
            } catch {
                warnings.push("Could not remove duplicate rows from Google Sheets in this run.");
            }
        }

        if (queued > 0) {
            await refreshPendingCount();
            warnings.push(
                `${queued} patient${queued === 1 ? "" : "s"} queued for Google Sheets sync.`
            );
        }

        if (skipped > 0) {
            warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped (missing full name).`);
        }
        if (duplicateSkipped > 0) {
            warnings.push(
                `${duplicateSkipped} duplicate row${
                    duplicateSkipped === 1 ? "" : "s"
                } skipped (already in CSV or existing patients).`
            );
        }
        if (localDuplicatesRemoved > 0) {
            warnings.push(
                `${localDuplicatesRemoved} duplicate patient record${
                    localDuplicatesRemoved === 1 ? "" : "s"
                } removed from local database.`
            );
        }
        if (sheetRowsRemovedById > 0) {
            warnings.push(
                `${sheetRowsRemovedById} duplicate row${
                    sheetRowsRemovedById === 1 ? "" : "s"
                } removed from Google Sheets by patient ID.`
            );
        }
        if (sheetDuplicateRowsRemoved > 0) {
            warnings.push(
                `${sheetDuplicateRowsRemoved} additional duplicate row${
                    sheetDuplicateRowsRemoved === 1 ? "" : "s"
                } removed from Google Sheets.`
            );
        }

        const sheetRowsRemovedTotal = sheetRowsRemovedById + sheetDuplicateRowsRemoved;
        if (localDuplicatesRemoved > 0 || sheetRowsRemovedTotal > 0) {
            recordDuplicateCleanupStatus({
                localRemoved: localDuplicatesRemoved,
                sheetRemoved: sheetRowsRemovedTotal,
                queuedActions: cleanupQueuedActions,
                hasSpreadsheetId: Boolean(targetSpreadsheetId),
                canSyncNow,
            });
        }

        await loadAll();

        const messageParts = [`Imported ${imported} patient${imported === 1 ? "" : "s"} from ${fileName}.`];
        messageParts.push(`${created} created, ${updated} updated.`);
        if (syncedNow > 0) {
            messageParts.push(`${syncedNow} synced to Google Sheets.`);
        }
        if (!targetSpreadsheetId) {
            messageParts.push("No Spreadsheet ID configured, so import stayed local.");
        }

        setSaveMessage(messageParts.join(" "));
        setSaveWarning(warnings.length > 0 ? warnings.join(" ") : null);
    };

    const importPatientsFromCsvData = async (
        payload: CsvImportPayload,
        mapping: CsvColumnMappingState
    ) => {
        if (!mapping.fullName) {
            throw new Error("Map Full Name before importing.");
        }

        const { headers, rows: dataRows } = payload;
        const parsedRows = dataRows
            .map((row) => parsePatientRowFromCsv(headers, row, mapping))
            .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null);
        await persistParsedPatients(
            parsedRows,
            payload.fileName,
            dataRows.length - parsedRows.length
        );
    };

    const importPatientsFromUnstructuredCsvRows = async (rows: string[][], fileName: string) => {
        if (rows.length === 0) {
            throw new Error("CSV file is empty.");
        }

        const { textIndex, cityIndex } = detectUnstructuredCsvColumns(rows);
        const parsedRows: CsvParsedPatient[] = [];
        const warnings: string[] = ["Headerless CSV detected. Row text was parsed with AI extraction."];
        let skipped = 0;
        let extractionFailures = 0;

        for (const row of rows) {
            const rawText = (row[textIndex] ?? "").trim();
            const city = cityIndex !== null ? (row[cityIndex] ?? "").trim() : "";

            if (!rawText) {
                skipped += 1;
                continue;
            }

            const referralText = [rawText, city].filter(Boolean).join(", ");

            try {
                const extracted = await extractPatient(
                    referralText.length >= 10 ? referralText : `${referralText} patient`
                );
                const fullName = extracted.fullName.trim() || inferNameFromUnstructuredText(rawText);
                if (!fullName) {
                    skipped += 1;
                    continue;
                }

                parsedRows.push({
                    fullName,
                    nicknames: [],
                    phone: extracted.phone.trim() || inferPhoneFromUnstructuredText(rawText),
                    alternateContacts: extracted.alternateContacts,
                    address: mergeAddressWithCity(extracted.address, city),
                    email: extracted.email.trim() || undefined,
                    status: "active",
                    notes: extracted.notes.trim(),
                });
            } catch {
                extractionFailures += 1;
                skipped += 1;
            }
        }

        if (extractionFailures > 0) {
            warnings.push(
                `${extractionFailures} row${
                    extractionFailures === 1 ? "" : "s"
                } could not be parsed with AI and were skipped.`
            );
        }

        if (parsedRows.length === 0) {
            throw new Error(
                "No patient rows could be extracted from this file. Try a CSV with headers or cleaner row text."
            );
        }

        await persistParsedPatients(parsedRows, fileName, skipped, warnings);
    };

    const handleCsvFile = async (file: File) => {
        if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
            setSaveMessage(null);
            setSaveWarning("Please choose a CSV file.");
            return;
        }

        setSaveMessage(null);
        setSaveWarning(null);
        setFormError(null);
        setCsvMappingError(null);
        setShowCsvMappingModal(false);

        try {
            const raw = await file.text();
            const rows = parseCsv(raw);
            if (rows.length === 0) {
                throw new Error("CSV file is empty.");
            }

            const hasHeaderRow = isLikelyHeaderRow(rows[0]);
            if (!hasHeaderRow) {
                setIsImportingCsv(true);
                try {
                    await importPatientsFromUnstructuredCsvRows(rows, file.name);
                } finally {
                    setIsImportingCsv(false);
                }
                return;
            }

            if (rows.length < 2) {
                throw new Error("CSV must include a header row and at least one patient row.");
            }

            const headers = rows[0];
            const dataRows = rows.slice(1);
            const heuristicMapping = guessCsvMapping(headers);
            setCsvMapping(heuristicMapping);
            setCsvImportPayload({
                headers,
                rows: dataRows,
                fileName: file.name,
            });
            setShowCsvMappingModal(true);
            setIsMappingCsv(true);

            try {
                const mapped = await mapCsvColumns(headers, dataRows.slice(0, 20));
                const aiMapping = toCsvMappingState(mapped.mapping);
                const merged: CsvColumnMappingState = { ...heuristicMapping };

                for (const field of CSV_TARGET_FIELDS) {
                    const sourceHeader = aiMapping[field.key];
                    if (sourceHeader && headers.includes(sourceHeader)) {
                        merged[field.key] = sourceHeader;
                    }
                }

                setCsvMapping(merged);
                setCsvMappingConfidence(mapped.confidence ?? {});
                setCsvMappingError(null);
            } catch (err) {
                setCsvMapping(heuristicMapping);
                setCsvMappingConfidence({});
                setCsvMappingError(
                    err instanceof Error
                        ? `AI mapping unavailable: ${err.message}. You can map fields manually.`
                        : "AI mapping unavailable. You can map fields manually."
                );
            } finally {
                setIsMappingCsv(false);
            }
        } catch (err) {
            setSaveMessage(null);
            setSaveWarning(null);
            setFormError(err instanceof Error ? err.message : "CSV import failed.");
        }
    };

    const handleCsvMappingChange = (field: CsvTargetField, value: string) => {
        setCsvMapping((current) => ({
            ...current,
            [field]: value || null,
        }));
    };

    const handleCleanExistingDuplicates = async () => {
        const confirmed = window.confirm(
            "Clean duplicate patients from the app database? This may also remove matching duplicate rows in Google Sheets."
        );
        if (!confirmed) {
            return;
        }

        setIsCleaningDuplicates(true);
        setSaveMessage(null);
        setSaveWarning(null);
        setFormError(null);

        try {
            const targetSpreadsheetId = spreadsheetId.trim();
            const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
            const canSyncNow = Boolean(targetSpreadsheetId && isSignedIn() && isOnline);
            const warnings: string[] = [];

            let queued = 0;
            let syncedNow = 0;
            let sheetRowsRemovedById = 0;
            let sheetDuplicateRowsRemoved = 0;
            let cleanupQueuedActions = 0;

            const dedupeResult = await dedupeLocalPatients();
            const localDuplicatesRemoved = dedupeResult.removedPatientIds.length;

            if (targetSpreadsheetId && localDuplicatesRemoved > 0) {
                if (canSyncNow) {
                    for (const canonicalId of dedupeResult.canonicalPatientIdsToResync) {
                        const canonicalPatient = await patientDB.get(canonicalId);
                        if (!canonicalPatient) {
                            continue;
                        }
                        try {
                            await syncPatientToSheets(targetSpreadsheetId, canonicalPatient);
                            syncedNow += 1;
                        } catch {
                            await queuePatientSheetsSync(canonicalPatient.id, false);
                            queued += 1;
                            cleanupQueuedActions += 1;
                        }
                    }

                    try {
                        sheetRowsRemovedById = await deletePatientsFromSheetByIds(
                            targetSpreadsheetId,
                            dedupeResult.removedPatientIds
                        );
                    } catch {
                        for (const removedId of dedupeResult.removedPatientIds) {
                            await queuePatientDeleteSheetsSync(removedId, false);
                            queued += 1;
                            cleanupQueuedActions += 1;
                        }
                    }

                    try {
                        sheetDuplicateRowsRemoved = await removeDuplicatePatientRowsInSheet(
                            targetSpreadsheetId
                        );
                    } catch {
                        warnings.push("Could not remove duplicate rows from Google Sheets in this run.");
                    }
                } else {
                    for (const canonicalId of dedupeResult.canonicalPatientIdsToResync) {
                        await queuePatientSheetsSync(canonicalId, false);
                        queued += 1;
                        cleanupQueuedActions += 1;
                    }
                    for (const removedId of dedupeResult.removedPatientIds) {
                        await queuePatientDeleteSheetsSync(removedId, false);
                        queued += 1;
                        cleanupQueuedActions += 1;
                    }
                }
            } else if (targetSpreadsheetId && canSyncNow) {
                try {
                    sheetDuplicateRowsRemoved = await removeDuplicatePatientRowsInSheet(
                        targetSpreadsheetId
                    );
                } catch {
                    warnings.push("Could not remove duplicate rows from Google Sheets in this run.");
                }
            }

            if (queued > 0) {
                await refreshPendingCount();
                warnings.push(
                    `${queued} patient sync action${queued === 1 ? "" : "s"} queued for Google Sheets.`
                );
            }

            await loadAll();

            const sheetRowsRemovedTotal = sheetRowsRemovedById + sheetDuplicateRowsRemoved;
            recordDuplicateCleanupStatus({
                localRemoved: localDuplicatesRemoved,
                sheetRemoved: sheetRowsRemovedTotal,
                queuedActions: cleanupQueuedActions,
                hasSpreadsheetId: Boolean(targetSpreadsheetId),
                canSyncNow,
            });

            if (localDuplicatesRemoved === 0 && sheetRowsRemovedTotal === 0) {
                setSaveMessage("No duplicate patients found.");
            } else {
                const parts = ["Duplicate cleanup complete."];
                if (localDuplicatesRemoved > 0) {
                    parts.push(
                        `${localDuplicatesRemoved} local duplicate patient record${
                            localDuplicatesRemoved === 1 ? "" : "s"
                        } removed.`
                    );
                }
                if (sheetRowsRemovedTotal > 0) {
                    parts.push(
                        `${sheetRowsRemovedTotal} duplicate Google Sheets row${
                            sheetRowsRemovedTotal === 1 ? "" : "s"
                        } removed.`
                    );
                }
                if (syncedNow > 0) {
                    parts.push(
                        `${syncedNow} canonical patient record${
                            syncedNow === 1 ? "" : "s"
                        } synced to Google Sheets.`
                    );
                }
                setSaveMessage(parts.join(" "));
            }

            setSaveWarning(warnings.length > 0 ? warnings.join(" ") : null);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Duplicate cleanup failed.");
        } finally {
            setIsCleaningDuplicates(false);
        }
    };

    const handleConfirmCsvImport = async () => {
        if (!csvImportPayload) {
            return;
        }

        setIsImportingCsv(true);
        setSaveMessage(null);
        setSaveWarning(null);
        setFormError(null);

        try {
            await importPatientsFromCsvData(csvImportPayload, csvMapping);
            setShowCsvMappingModal(false);
            setCsvImportPayload(null);
            setCsvMapping({ ...EMPTY_CSV_MAPPING });
            setCsvMappingConfidence({});
            setCsvMappingError(null);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "CSV import failed.");
        } finally {
            setIsImportingCsv(false);
        }
    };

    const handleExtractFromIntake = async () => {
        if (!intakeText.trim()) {
            setFormError("Paste patient information before extracting.");
            return;
        }

        setIsExtracting(true);
        setFormError(null);

        try {
            const extracted = await extractPatient(intakeText);
            setFormData((prev) => ({
                ...prev,
                fullName: extracted.fullName || prev.fullName,
                phone: extracted.phone || prev.phone,
                address: extracted.address || prev.address,
                email: extracted.email || prev.email,
                alternateContacts:
                    extracted.alternateContacts.length > 0
                        ? serializeAlternateContactsField(extracted.alternateContacts)
                        : prev.alternateContacts,
                notes: extracted.notes
                    ? [prev.notes, extracted.notes].filter(Boolean).join("\n").trim()
                    : prev.notes,
            }));
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to extract patient details.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.fullName.trim()) {
            setFormError("Patient name is required.");
            return;
        }

        setIsSaving(true);
        setFormError(null);
        setSaveMessage(null);
        setSaveWarning(null);

        try {
            const normalizedEmail = formData.email.trim();
            const notesWithEmail = [formData.notes.trim(), normalizedEmail ? `Email: ${normalizedEmail}` : ""]
                .filter(Boolean)
                .join("\n");

            const id = await add({
                fullName: formData.fullName.trim(),
                nicknames: formData.nicknames
                    .split(",")
                    .map((n) => n.trim())
                    .filter(Boolean),
                phone: formData.phone.trim(),
                alternateContacts: parseAlternateContactsField(formData.alternateContacts),
                address: formData.address.trim(),
                email: normalizedEmail || undefined,
                status: formData.status,
                notes: notesWithEmail,
            });

            const targetSpreadsheetId = spreadsheetId.trim();
            if (!targetSpreadsheetId) {
                setSaveMessage("Patient added to local database.");
            } else {
                const createdPatient = await patientDB.get(id);
                const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

                if (createdPatient && isSignedIn() && isOnline) {
                    try {
                        await syncPatientToSheetByStatus(targetSpreadsheetId, createdPatient);
                        setSaveMessage("Patient added and synced to Google Sheets.");
                    } catch {
                        await queuePatientSheetsSync(id);
                        setSaveWarning(
                            "Patient added locally. Google Sheets sync failed now and was queued."
                        );
                    }
                } else {
                    await queuePatientSheetsSync(id);
                    setSaveWarning(
                        "Patient added locally. Google Sheets sync queued for the next online signed-in sync."
                    );
                }
            }

            setIsAddOpen(false);
            setFormData(emptyForm);
            setIntakeText("");
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to add patient.");
        } finally {
            setIsSaving(false);
        }
    };

    const buildPhoneHref = (phone?: string) => {
        if (!phone) return null;
        return `tel:${phone.replace(/[^\d+]/g, "")}`;
    };

    const buildMapsHref = (address?: string) => {
        if (!address?.trim()) return null;
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    };

    return (
        <div className="pb-20 max-w-2xl mx-auto">
            {/* Search Header */}
            <div className="sticky top-0 bg-[var(--color-surface)] z-10 px-4 py-3 border-b border-[var(--color-border)]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-secondary)]" />
                    <input
                        type="search"
                        placeholder="Search patients..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface-hover)] border-none rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    />
                </div>
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={() => setShowDischarged(false)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!showDischarged
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]"
                            }`}
                    >
                        Current ({patients.filter((p) => p.status !== "discharged").length})
                    </button>
                    <button
                        onClick={() => setShowDischarged(true)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${showDischarged
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]"
                            }`}
                    >
                        Discharged ({patients.filter((p) => p.status === "discharged").length})
                    </button>
                </div>
            </div>

            {/* Patients List */}
            <div className="p-4 space-y-3">
                <Card>
                    <CardHeader
                        title="Bulk Import CSV"
                        subtitle="Import structured or unstructured CSV files in bulk"
                    />
                    <div
                        onDragOver={(event) => {
                            event.preventDefault();
                            setIsCsvDragging(true);
                        }}
                        onDragLeave={() => setIsCsvDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setIsCsvDragging(false);
                            const file = event.dataTransfer.files?.[0];
                            if (file) {
                                void handleCsvFile(file);
                            }
                        }}
                        className={`rounded border-2 border-dashed p-4 text-center ${
                            isCsvDragging ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]" : "border-[var(--color-border)] bg-[var(--color-skeleton-shine)]"
                        }`}
                    >
                        <p className="text-sm text-[var(--color-text-primary)]">Drop CSV file here</p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-3">
                            Header CSVs open field mapping. Headerless row-text CSVs are parsed with AI automatically.
                        </p>
                        <label className="inline-block cursor-pointer">
                            <Button
                                variant="secondary"
                                as="span"
                                disabled={isImportingCsv || isMappingCsv || isCleaningDuplicates}
                            >
                                {isMappingCsv
                                    ? "Analyzing columns..."
                                    : isImportingCsv
                                    ? "Importing..."
                                    : "Choose CSV File"}
                            </Button>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) {
                                        void handleCsvFile(file);
                                    }
                                    event.currentTarget.value = "";
                                }}
                            />
                        </label>
                        <div className="mt-3">
                            <Button
                                variant="ghost"
                                onClick={() => void handleCleanExistingDuplicates()}
                                disabled={isImportingCsv || isMappingCsv || isCleaningDuplicates}
                            >
                                {isCleaningDuplicates
                                    ? "Cleaning duplicates..."
                                    : "Clean Existing Duplicates"}
                            </Button>
                        </div>
                        {duplicateCleanupStatus && (
                            <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left">
                                <p className="text-xs text-[var(--color-text-primary)]">
                                    Last duplicate cleanup:{" "}
                                    <span className="font-medium">
                                        {formatCleanupStatusTime(duplicateCleanupStatus.completedAt)}
                                    </span>
                                </p>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Local removed: {duplicateCleanupStatus.localRemoved}. Sheets removed:{" "}
                                    {duplicateCleanupStatus.sheetRemoved}. Queued:{" "}
                                    {duplicateCleanupStatus.queuedActions}.
                                </p>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    {duplicateCleanupStatus.sheetSyncSummary}
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="mt-3 flex flex-col gap-1">
                        <a
                            href="/templates/patients_template.csv"
                            download
                            className="text-sm text-[var(--color-primary)] hover:underline"
                        >
                            Download CSV template
                        </a>
                        <a
                            href="/templates/patients_sample_15.csv"
                            download
                            className="text-sm text-[var(--color-primary)] hover:underline"
                        >
                            Download sample CSV (15 patients)
                        </a>
                    </div>
                </Card>

                {saveMessage && (
                    <div className="rounded border border-green-600 dark:border-green-400 bg-green-50 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-300">
                        {saveMessage}
                    </div>
                )}
                {saveWarning && (
                    <div className="rounded border border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
                        {saveWarning}
                    </div>
                )}

                {loading ? (
                    <PatientListSkeleton count={5} />
                ) : filteredPatients.length === 0 ? (
                    searchQuery ? (
                        <SearchEmptyState
                            query={searchQuery}
                            onClearSearch={() => search("")}
                        />
                    ) : (
                        <PatientsEmptyState onAddPatient={handleOpenAdd} />
                    )
                ) : (
                    filteredPatients.map((patient) => (
                        <Card key={patient.id} className="group hover:shadow-md transition-shadow">
                            <Link to={`/patients/${patient.id}`} className="block">
                                <CardHeader
                                    title={patient.fullName}
                                    subtitle={patient.address || "No address"}
                                />
                            </Link>
                            <div className="flex items-center gap-3 mt-2">
                                {patient.phone && (
                                    <a
                                        href={buildPhoneHref(patient.phone)!}
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[var(--color-primary)] text-sm hover:underline"
                                        aria-label={`Call ${patient.fullName}`}
                                    >
                                        <Phone className="w-4 h-4" />
                                        {patient.phone}
                                    </a>
                                )}
                                {patient.address && (
                                    <a
                                        href={buildMapsHref(patient.address)!}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[var(--color-primary)] text-sm hover:underline"
                                        aria-label={`Navigate to ${patient.fullName}`}
                                    >
                                        <Navigation className="w-4 h-4" />
                                        Directions
                                    </a>
                                )}
                            </div>
                        </Card>
                    ))
                )}
            </div>

            {/* Floating Add Button */}
            <button
                onClick={handleOpenAdd}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--color-primary)] text-white shadow-lg hover:shadow-xl hover:bg-[var(--color-primary-hover)] transition-all flex items-center justify-center"
                aria-label="Add patient"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* CSV Mapping Modal */}
            {showCsvMappingModal && csvImportPayload && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
                    onClick={() => setShowCsvMappingModal(false)}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-slide-in"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
                            <h2 className="text-lg font-medium text-[var(--color-text-primary)]">CSV Field Mapping</h2>
                            <button
                                onClick={() => setShowCsvMappingModal(false)}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                                aria-label="Close CSV mapping"
                            >
                                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <p className="text-sm text-[var(--color-text-primary)]">
                                File: <span className="font-medium">{csvImportPayload.fileName}</span> •{" "}
                                {csvImportPayload.rows.length} row
                                {csvImportPayload.rows.length === 1 ? "" : "s"}
                            </p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                                Confirm which CSV column should fill each patient field.
                            </p>

                            {isMappingCsv && (
                                <p className="text-sm text-[var(--color-primary)]">AI is analyzing headers and sample rows...</p>
                            )}

                            {csvMappingError && (
                                <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-500 dark:border-amber-400 rounded p-3">
                                    {csvMappingError}
                                </p>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {CSV_TARGET_FIELDS.map((field) => {
                                    const confidence = csvMappingConfidence[field.key];
                                    return (
                                        <div key={field.key}>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                                {field.label}
                                                {field.required ? " *" : ""}
                                                {typeof confidence === "number" && (
                                                    <span className="ml-2 text-xs text-[var(--color-primary)]">
                                                        {Math.round(confidence * 100)}%
                                                    </span>
                                                )}
                                            </label>
                                            <select
                                                value={csvMapping[field.key] ?? ""}
                                                onChange={(event) =>
                                                    handleCsvMappingChange(field.key, event.target.value)
                                                }
                                                className="w-full input-google"
                                            >
                                                <option value="">(Not mapped)</option>
                                                {csvImportPayload.headers.map((header) => (
                                                    <option key={header} value={header}>
                                                        {header}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] sticky bottom-0 bg-[var(--color-surface)]">
                            <Button
                                variant="ghost"
                                onClick={() => setShowCsvMappingModal(false)}
                                disabled={isImportingCsv}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => void handleConfirmCsvImport()}
                                disabled={isImportingCsv || isMappingCsv || !csvMapping.fullName}
                            >
                                {isImportingCsv ? "Importing..." : "Import Patients"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Patient Modal */}
            {isAddOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
                    onClick={handleCloseAdd}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto animate-slide-in"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
                            <h2 className="text-lg font-medium text-[var(--color-text-primary)]">Add Patient</h2>
                            <button
                                onClick={handleCloseAdd}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                            >
                                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Intake Text (AI Extract)
                                </label>
                                <textarea
                                    value={intakeText}
                                    onChange={(e) => setIntakeText(e.target.value)}
                                    className="w-full input-google resize-y py-2 min-h-[96px]"
                                    placeholder="Paste unstructured patient info here..."
                                />
                                <div className="mt-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => void handleExtractFromIntake()}
                                        disabled={isExtracting}
                                    >
                                        {isExtracting ? "Extracting..." : "Extract with AI"}
                                    </Button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Full Name *
                                </label>
                                <input
                                    type="text"
                                    value={formData.fullName}
                                    onChange={(e) => handleInputChange("fullName", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="Jane Doe"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Nicknames
                                </label>
                                <input
                                    type="text"
                                    value={formData.nicknames}
                                    onChange={(e) => handleInputChange("nicknames", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="Janie, Jan (comma separated)"
                                />
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Comma-separated list for matching
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Phone
                                </label>
                                <input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => handleInputChange("phone", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="555-123-4567"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Address
                                </label>
                                <input
                                    type="text"
                                    value={formData.address}
                                    onChange={(e) => handleInputChange("address", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="123 Main St, Boise, ID 83702"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => handleInputChange("email", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="name@example.com"
                                />
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Stored locally and appended to notes for Google Sheets.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Alternate Contacts
                                </label>
                                <textarea
                                    value={formData.alternateContacts}
                                    onChange={(e) => handleInputChange("alternateContacts", e.target.value)}
                                    className="w-full input-google resize-y py-2 min-h-[72px]"
                                    placeholder="Name|Phone|Relationship; Name|Phone"
                                />
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Format: Name|Phone|Relationship; Name|Phone
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Status
                                </label>
                                <select
                                    value={formData.status}
                                    onChange={(e) =>
                                        handleInputChange("status", e.target.value as PatientStatus)
                                    }
                                    className="w-full input-google"
                                >
                                    <option value="active">Active</option>
                                    <option value="evaluation">Evaluation</option>
                                    <option value="discharged">Discharged</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Notes
                                </label>
                                <textarea
                                    value={formData.notes}
                                    onChange={(e) => handleInputChange("notes", e.target.value)}
                                    className="w-full input-google resize-none"
                                    rows={3}
                                    placeholder="Any relevant notes..."
                                />
                            </div>

                            {formError && (
                                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] sticky bottom-0 bg-[var(--color-surface)]">
                            <Button variant="ghost" onClick={handleCloseAdd} disabled={isSaving}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => void handleSubmit()}
                                disabled={isSaving}
                            >
                                {isSaving ? "Saving..." : "Add Patient"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
