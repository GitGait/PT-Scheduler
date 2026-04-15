import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePatientStore, useSyncStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PatientListSkeleton } from "../components/ui/Skeleton";
import { PatientsEmptyState, SearchEmptyState } from "../components/ui/EmptyState";
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
import { startOfWeek, endOfWeek } from "date-fns";
import type { Patient, PatientStatus } from "../types";
import { PERSONAL_PATIENT_ID } from "../utils/personalEventColors";

type PatientTab = "current" | "for-other-pt" | "discharged";

function isCurrentWeek(date?: Date): boolean {
    if (!date) return false;
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });       // Sunday
    return date >= weekStart && date <= weekEnd;
}

interface PatientFormData {
    fullName: string;
    nicknames: string;
    phoneNumbers: { number: string; label: string }[];
    address: string;
    facilityName: string;
    email: string;
    alternateContacts: string;
    notes: string;
    status: PatientStatus;
}

const emptyForm: PatientFormData = {
    fullName: "",
    nicknames: "",
    phoneNumbers: [{ number: "", label: "" }],
    address: "",
    facilityName: "",
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

interface PatientIdentityLike {
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

function buildPatientDedupKeys(patient: PatientIdentityLike): string[] {
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

export function PatientsPage() {
    const { patients, loadAll, search, loading, add } = usePatientStore();
    const { spreadsheetId, refreshPendingCount } = useSyncStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTab, setActiveTab] = useState<PatientTab>("current");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const backdropMouseDownRef = useRef<EventTarget | null>(null);
    const formContentRef = useRef<HTMLDivElement>(null);
    const [formData, setFormData] = useState<PatientFormData>(emptyForm);
    const [formError, setFormError] = useState<string | null>(null);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveWarning, setSaveWarning] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [intakeText, setIntakeText] = useState("");
    const [isExtracting, setIsExtracting] = useState(false);
    const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
    const [duplicateCleanupStatus, setDuplicateCleanupStatus] =
        useState<DuplicateCleanupStatus | null>(() => loadDuplicateCleanupStatus());

    useEffect(() => {
        if (searchQuery.trim()) {
            search(searchQuery);
        } else {
            loadAll();
        }
    }, [searchQuery, search, loadAll]);

    const filteredPatients = patients
        .filter((p) => {
            if (p.id === PERSONAL_PATIENT_ID) return false;
            if (activeTab === "current") {
                if (p.status === "discharged") return false;
                if (p.status === "for-other-pt") return isCurrentWeek(p.forOtherPtAt);
                return true;
            }
            if (activeTab === "for-other-pt") return p.status === "for-other-pt";
            return p.status === "discharged";
        })
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

    const handleInputChange = (field: keyof PatientFormData, value: PatientFormData[keyof PatientFormData]) => {
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
                phoneNumbers: extracted.phone
                    ? [{ number: extracted.phone, label: "" }]
                    : prev.phoneNumbers,
                address: extracted.address || prev.address,
                facilityName: extracted.facilityName || prev.facilityName,
                email: extracted.email || prev.email,
                alternateContacts:
                    extracted.alternateContacts && extracted.alternateContacts.length > 0
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
            requestAnimationFrame(() => {
                formContentRef.current?.scrollTo({ top: formContentRef.current.scrollHeight, behavior: "smooth" });
            });
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
                phoneNumbers: formData.phoneNumbers
                    .filter((pn) => pn.number.trim())
                    .map((pn) => {
                        const label = pn.label.trim();
                        return label ? { number: pn.number.trim(), label } : { number: pn.number.trim() };
                    }),
                alternateContacts: parseAlternateContactsField(formData.alternateContacts),
                address: formData.address.trim(),
                facilityName: formData.facilityName.trim() || undefined,
                email: normalizedEmail || undefined,
                status: formData.status,
                notes: notesWithEmail,
                ...(formData.status === "for-other-pt" ? { forOtherPtAt: new Date() } : {}),
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
                        placeholder="Search by name or phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface-hover)] border-none rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    />
                </div>
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={() => setActiveTab("current")}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "current"
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]"
                            }`}
                    >
                        Current ({patients.filter((p) => p.id !== PERSONAL_PATIENT_ID && p.status !== "discharged" && p.status !== "for-other-pt").length + patients.filter((p) => p.id !== PERSONAL_PATIENT_ID && p.status === "for-other-pt" && isCurrentWeek(p.forOtherPtAt)).length})
                    </button>
                    <button
                        onClick={() => setActiveTab("for-other-pt")}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "for-other-pt"
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]"
                            }`}
                    >
                        Other PT ({patients.filter((p) => p.id !== PERSONAL_PATIENT_ID && p.status === "for-other-pt").length})
                    </button>
                    <button
                        onClick={() => setActiveTab("discharged")}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "discharged"
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]"
                            }`}
                    >
                        Discharged ({patients.filter((p) => p.id !== PERSONAL_PATIENT_ID && p.status === "discharged").length})
                    </button>
                </div>
            </div>

            {/* Patients List */}
            <div className="p-4 space-y-3">
                <Card>
                    <CardHeader
                        title="Patient Duplicates"
                        subtitle="Merge duplicate patient records in the local database (and Google Sheets if configured)"
                    />
                    <Button
                        variant="secondary"
                        onClick={() => void handleCleanExistingDuplicates()}
                        disabled={isCleaningDuplicates}
                    >
                        {isCleaningDuplicates ? "Cleaning duplicates..." : "Clean Existing Duplicates"}
                    </Button>
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
                            onClearSearch={() => { setSearchQuery(""); search(""); }}
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
                                    subtitle={patient.facilityName ? `${patient.facilityName} — ${patient.address || "No address"}` : patient.address || "No address"}
                                />
                            </Link>
                            <div className="flex items-center gap-3 mt-2">
                                {patient.phoneNumbers[0]?.number && (
                                    <a
                                        href={buildPhoneHref(patient.phoneNumbers[0].number) ?? "#"}
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[var(--color-primary)] text-sm hover:underline"
                                        aria-label={`Call ${patient.fullName}`}
                                    >
                                        <Phone className="w-4 h-4" />
                                        {patient.phoneNumbers[0].number}
                                    </a>
                                )}
                                {patient.address && (
                                    <a
                                        href={buildMapsHref(patient.address) ?? "#"}
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

            {/* Add Patient Modal */}
            {isAddOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
                    onMouseDown={(e) => { backdropMouseDownRef.current = e.target; }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && backdropMouseDownRef.current === e.currentTarget) {
                            handleCloseAdd();
                        }
                    }}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col animate-slide-in"
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
                            <h2 className="text-lg font-medium text-[var(--color-text-primary)]">Add Patient</h2>
                            <button
                                onClick={handleCloseAdd}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                            >
                                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                            </button>
                        </div>

                        <div ref={formContentRef} className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
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
                                    Phone Numbers
                                </label>
                                <div className="space-y-2">
                                    {formData.phoneNumbers.map((pn, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <input
                                                type="text"
                                                value={pn.label}
                                                onChange={(e) => {
                                                    const updated = [...formData.phoneNumbers];
                                                    updated[idx] = { ...updated[idx], label: e.target.value };
                                                    handleInputChange("phoneNumbers", updated);
                                                }}
                                                className="w-[30%] input-google"
                                                placeholder="Label (optional)"
                                            />
                                            <input
                                                type="tel"
                                                value={pn.number}
                                                onChange={(e) => {
                                                    const updated = [...formData.phoneNumbers];
                                                    updated[idx] = { ...updated[idx], number: e.target.value };
                                                    handleInputChange("phoneNumbers", updated);
                                                }}
                                                className="flex-1 input-google"
                                                placeholder="555-123-4567"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (formData.phoneNumbers.length <= 1) {
                                                        handleInputChange("phoneNumbers", [{ number: "", label: "" }]);
                                                    } else {
                                                        handleInputChange(
                                                            "phoneNumbers",
                                                            formData.phoneNumbers.filter((_, i) => i !== idx)
                                                        );
                                                    }
                                                }}
                                                className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                                                aria-label="Remove phone number"
                                            >
                                                <X className="w-4 h-4 text-red-500" />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() =>
                                            handleInputChange("phoneNumbers", [
                                                ...formData.phoneNumbers,
                                                { number: "", label: "" },
                                            ])
                                        }
                                        className="text-sm text-[var(--color-primary)] hover:underline"
                                    >
                                        + Add phone number
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Facility Name
                                </label>
                                <input
                                    type="text"
                                    value={formData.facilityName}
                                    onChange={(e) => handleInputChange("facilityName", e.target.value)}
                                    className="w-full input-google"
                                    placeholder="e.g., Sunrise Senior Living (optional)"
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
                                    <option value="for-other-pt">For Other PT</option>
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

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] shrink-0">
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
