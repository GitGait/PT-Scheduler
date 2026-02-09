import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { processScreenshotFile } from "../api/ocr";
import { geocodeAddress } from "../api/geocode";
import { matchPatient, type MatchCandidate, type MatchTier } from "../utils/matching";
import { usePatientStore, useAppointmentStore } from "../stores";
import type { ExtractedAppointment, Patient } from "../types";
import {
    Upload,
    Check,
    X,
    AlertCircle,
    ChevronDown,
    Camera,
    FileText,
} from "lucide-react";

interface OCRResult extends ExtractedAppointment {
    matchedPatientId?: string;
    matchedPatientName?: string;
    tier: MatchTier;
    confidence: number;
    confirmed: boolean;
    alternatives: { id: string; name: string; confidence: number }[];
    isMatching: boolean;
}

import { getHomeBase } from "../utils/scheduling";
const EARTH_RADIUS_MILES = 3958.8;
const SLOT_MINUTES = 15;

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

function calculateMilesBetweenCoordinates(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): number {
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_MILES * c;
}

function timeStringToMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map((value) => Number(value));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return 0;
    }
    return hours * 60 + minutes;
}

function minutesToTimeString(totalMinutes: number): string {
    const bounded = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
    const hours = Math.floor(bounded / 60);
    const minutes = bounded % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeVisitType(value?: string): string | undefined {
    const raw = (value ?? "").trim();
    if (!raw) {
        return undefined;
    }

    const cleaned = raw
        .replace(/^[\[\(\{<]+|[\]\)\}>]+$/g, "")
        .replace(/^visit\s*type\s*[:\-]?\s*/i, "")
        .replace(/[–—]/g, "-")
        .replace(/^[\s:;\-]+|[\s:;\-]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return undefined;
    }

    const alphaNumeric = cleaned.match(/^([A-Za-z]{1,6})\s*[-]?\s*(\d{1,3})$/);
    if (alphaNumeric) {
        return `${alphaNumeric[1].toUpperCase()}${alphaNumeric[2]}`;
    }

    const keyword = cleaned.match(/^(EVAL|SOC|DC|ROC|RE[-\s]?EVAL)$/i);
    if (keyword) {
        return keyword[1].toUpperCase().replace(/[-\s]/g, "");
    }

    return cleaned.toUpperCase();
}

const VISIT_TYPE_PREFIX_REGEX =
    /^([A-Za-z]{1,6}\s*[-]?\s*\d{1,3}|EVAL|SOC|DC|ROC|RE[-\s]?EVAL)\s*(?:[-:–—]\s*|\s+)(.+)$/i;

function parseVisitTypeAndName(input: {
    rawName: string;
    visitType?: string;
}): { rawName: string; visitType?: string } {
    const nameValue = (input.rawName ?? "").replace(/\s+/g, " ").trim();
    const visitTypeValue = normalizeVisitType(input.visitType);

    if (visitTypeValue) {
        const withoutVisitType = nameValue
            .replace(
                /^([A-Za-z]{1,6}\s*[-]?\s*\d{1,3}|EVAL|SOC|DC|ROC|RE[-\s]?EVAL)\s*(?:[-:–—]\s*)?/i,
                ""
            )
            .trim();
        return {
            rawName: withoutVisitType || nameValue,
            visitType: visitTypeValue,
        };
    }

    const match = nameValue.match(VISIT_TYPE_PREFIX_REGEX);
    if (match) {
        const normalizedVisitType = normalizeVisitType(match[1]);
        return {
            rawName: match[2].trim() || nameValue,
            visitType: normalizedVisitType,
        };
    }

    return { rawName: nameValue };
}

export function ScanPage() {
    const navigate = useNavigate();
    const { patients, loadAll: loadPatients } = usePatientStore();
    const { create: createAppointment, update: updateAppointment } = useAppointmentStore();

    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState<OCRResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importSuccess, setImportSuccess] = useState<number | null>(null);
    const [importRouteMessage, setImportRouteMessage] = useState<string | null>(null);

    useEffect(() => {
        loadPatients();
    }, [loadPatients]);

    const patientCandidates: MatchCandidate[] = patients.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        nicknames: p.nicknames,
    }));

    const resolveHomeCoordinates = useCallback(async () => {
        const homeBase = getHomeBase();

        // Use stored coordinates if available
        if (homeBase.lat !== 0 && homeBase.lng !== 0) {
            return { lat: homeBase.lat, lng: homeBase.lng };
        }

        // Try to geocode if we have an address
        if (homeBase.address) {
            try {
                const result = await geocodeAddress(homeBase.address);
                if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
                    return { lat: result.lat, lng: result.lng };
                }
            } catch {
                // Fall back to stored coordinates.
            }
        }

        return { lat: homeBase.lat, lng: homeBase.lng };
    }, []);

    const resolvePatientCoordinates = useCallback(
        async (
            patient: Patient,
            cache: Map<string, { lat: number; lng: number } | null>
        ): Promise<{ lat: number; lng: number } | null> => {
            const cached = cache.get(patient.id);
            if (cached !== undefined) {
                return cached;
            }

            if (patient.lat !== undefined && patient.lng !== undefined) {
                const coords = { lat: patient.lat, lng: patient.lng };
                cache.set(patient.id, coords);
                return coords;
            }

            if (!patient.address?.trim()) {
                cache.set(patient.id, null);
                return null;
            }

            try {
                const result = await geocodeAddress(patient.address);
                if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
                    const coords = { lat: result.lat, lng: result.lng };
                    cache.set(patient.id, coords);
                    return coords;
                }
            } catch {
                // Leave as unresolved.
            }

            cache.set(patient.id, null);
            return null;
        },
        []
    );

    const optimizeImportedAppointments = useCallback(
        async (
            importedAppointments: Array<{
                appointmentId: string;
                patientId: string;
                date: string;
                startTime: string;
                duration: number;
            }>
        ): Promise<{ optimizedDays: number; unresolvedStops: number }> => {
            if (importedAppointments.length < 2) {
                return { optimizedDays: 0, unresolvedStops: 0 };
            }

            const homeCoords = await resolveHomeCoordinates();
            const byDate = new Map<
                string,
                Array<{
                    appointmentId: string;
                    patientId: string;
                    date: string;
                    startTime: string;
                    duration: number;
                }>
            >();

            for (const item of importedAppointments) {
                const existing = byDate.get(item.date) ?? [];
                existing.push(item);
                byDate.set(item.date, existing);
            }

            let optimizedDays = 0;
            let unresolvedStops = 0;
            const patientById = new Map(patients.map((patient) => [patient.id, patient]));
            const coordinateCache = new Map<string, { lat: number; lng: number } | null>();

            for (const [date, dayItems] of byDate.entries()) {
                if (dayItems.length < 2) {
                    continue;
                }

                const dayStartMinutes = Math.min(
                    ...dayItems.map((item) => timeStringToMinutes(item.startTime))
                );

                const withDistance: Array<{
                    item: (typeof dayItems)[number];
                    distance: number;
                }> = [];
                const withoutDistance: typeof dayItems = [];

                for (const item of dayItems) {
                    const patient = patientById.get(item.patientId);
                    if (!patient) {
                        withoutDistance.push(item);
                        unresolvedStops += 1;
                        continue;
                    }

                    const coords = await resolvePatientCoordinates(patient, coordinateCache);
                    if (!coords) {
                        withoutDistance.push(item);
                        unresolvedStops += 1;
                        continue;
                    }

                    withDistance.push({
                        item,
                        distance: calculateMilesBetweenCoordinates(homeCoords, coords),
                    });
                }

                const orderedWithDistance = [...withDistance].sort((a, b) => {
                    if (b.distance !== a.distance) {
                        return b.distance - a.distance;
                    }
                    return a.item.startTime.localeCompare(b.item.startTime);
                });
                const orderedWithoutDistance = [...withoutDistance].sort((a, b) =>
                    a.startTime.localeCompare(b.startTime)
                );
                const ordered = [
                    ...orderedWithDistance.map((entry) => entry.item),
                    ...orderedWithoutDistance,
                ];

                let nextStartMinutes =
                    Math.max(0, Math.round(dayStartMinutes / SLOT_MINUTES) * SLOT_MINUTES);
                let changedAny = false;

                for (const item of ordered) {
                    const snappedStartMinutes = Math.max(
                        0,
                        Math.round(nextStartMinutes / SLOT_MINUTES) * SLOT_MINUTES
                    );
                    const nextStartTime = minutesToTimeString(snappedStartMinutes);

                    if (item.startTime !== nextStartTime) {
                        await updateAppointment(item.appointmentId, {
                            date,
                            startTime: nextStartTime,
                        });
                        changedAny = true;
                    }

                    nextStartMinutes = snappedStartMinutes + item.duration;
                }

                if (changedAny) {
                    optimizedDays += 1;
                }
            }

            return { optimizedDays, unresolvedStops };
        },
        [patients, resolveHomeCoordinates, resolvePatientCoordinates, updateAppointment]
    );

    const runMatchingForResult = useCallback(
        async (result: OCRResult, index: number) => {
            setResults((prev) =>
                prev.map((r, i) => (i === index ? { ...r, isMatching: true } : r))
            );

            try {
                const matchResult = await matchPatient(result.rawName, patientCandidates);

                setResults((prev) =>
                    prev.map((r, i) =>
                        i === index
                            ? {
                                  ...r,
                                  matchedPatientId: matchResult.candidate?.id,
                                  matchedPatientName: matchResult.candidate?.fullName,
                                  tier: matchResult.tier,
                                  confidence: matchResult.confidence,
                                  confirmed: matchResult.tier === "auto",
                                  alternatives: matchResult.alternatives.map((alt) => ({
                                      id: alt.candidate.id,
                                      name: alt.candidate.fullName,
                                      confidence: alt.confidence,
                                  })),
                                  isMatching: false,
                              }
                            : r
                    )
                );
            } catch {
                setResults((prev) =>
                    prev.map((r, i) =>
                        i === index
                            ? {
                                  ...r,
                                  tier: "manual",
                                  confidence: 0,
                                  isMatching: false,
                              }
                            : r
                    )
                );
            }
        },
        [patientCandidates]
    );

    const handleFile = useCallback(
        async (file: File) => {
            if (!file.type.startsWith("image/")) {
                setError("Please upload an image file");
                return;
            }

            setIsProcessing(true);
            setError(null);
            setResults([]);
            setImportSuccess(null);
            setImportRouteMessage(null);

            try {
                const response = await processScreenshotFile(file);
                const newResults: OCRResult[] = response.appointments.map((apt) => {
                    const normalized = parseVisitTypeAndName({
                        rawName: apt.rawName,
                        visitType: apt.visitType,
                    });

                    return {
                        ...apt,
                        rawName: normalized.rawName,
                        visitType: normalized.visitType,
                        tier: "manual" as MatchTier,
                        confidence: 0,
                        confirmed: false,
                        alternatives: [],
                        isMatching: true,
                    };
                });

                setResults(newResults);

                // Run matching for each result
                for (let i = 0; i < newResults.length; i++) {
                    await runMatchingForResult(newResults[i], i);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "OCR processing failed");
            } finally {
                setIsProcessing(false);
            }
        },
        [runMatchingForResult]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        },
        [handleFile]
    );

    const handleFileInput = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
        },
        [handleFile]
    );

    const handleConfirm = (index: number) => {
        setResults((prev) =>
            prev.map((r, i) => (i === index ? { ...r, confirmed: true } : r))
        );
    };

    const handleReject = (index: number) => {
        setResults((prev) =>
            prev.map((r, i) =>
                i === index
                    ? { ...r, confirmed: false, matchedPatientId: undefined, matchedPatientName: undefined }
                    : r
            )
        );
    };

    const handleSelectPatient = (index: number, patientId: string, patientName: string) => {
        setResults((prev) =>
            prev.map((r, i) =>
                i === index
                    ? {
                          ...r,
                          matchedPatientId: patientId,
                          matchedPatientName: patientName,
                          confirmed: true,
                          tier: "confirm" as MatchTier,
                          confidence: 100,
                      }
                    : r
            )
        );
    };

    const handleImportConfirmed = async () => {
        const confirmedResults = results.filter((r) => r.confirmed && r.matchedPatientId);

        if (confirmedResults.length === 0) {
            setError("No confirmed appointments to import.");
            return;
        }

        setIsImporting(true);
        setError(null);

        try {
            const importedAppointments: Array<{
                appointmentId: string;
                patientId: string;
                date: string;
                startTime: string;
                duration: number;
            }> = [];

            for (const result of confirmedResults) {
                const normalizedImport = parseVisitTypeAndName({
                    rawName: result.rawName,
                    visitType: result.visitType,
                });
                const visitType = normalizedImport.visitType;
                const notesWithVisitType = [
                    visitType ? `Visit Type: ${visitType}` : "",
                    result.notes ?? "",
                ]
                    .filter(Boolean)
                    .join("\n")
                    .trim();

                const appointmentId = await createAppointment({
                    patientId: result.matchedPatientId!,
                    date: result.date,
                    startTime: result.time,
                    duration: result.duration,
                    status: "scheduled",
                    syncStatus: "local",
                    notes: notesWithVisitType || undefined,
                });

                importedAppointments.push({
                    appointmentId,
                    patientId: result.matchedPatientId!,
                    date: result.date,
                    startTime: result.time,
                    duration: result.duration,
                });
            }

            const optimization = await optimizeImportedAppointments(importedAppointments);
            if (optimization.optimizedDays > 0) {
                const messageParts = [
                    `Auto-optimized ${optimization.optimizedDays} day${
                        optimization.optimizedDays === 1 ? "" : "s"
                    } by starting with farthest patients and routing back toward home.`,
                ];
                if (optimization.unresolvedStops > 0) {
                    messageParts.push(
                        `${optimization.unresolvedStops} stop${
                            optimization.unresolvedStops === 1 ? "" : "s"
                        } kept original relative order (missing coordinates).`
                    );
                }
                setImportRouteMessage(messageParts.join(" "));
            } else if (optimization.unresolvedStops > 0) {
                setImportRouteMessage(
                    `Could not fully optimize route order for ${optimization.unresolvedStops} stop${
                        optimization.unresolvedStops === 1 ? "" : "s"
                    } due to missing coordinates.`
                );
            } else {
                setImportRouteMessage(
                    "Imported appointments kept their original order for each day."
                );
            }

            setImportSuccess(confirmedResults.length);
            setResults([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to import appointments.");
        } finally {
            setIsImporting(false);
        }
    };

    const confirmedCount = results.filter((r) => r.confirmed && r.matchedPatientId).length;
    const pendingCount = results.filter((r) => !r.confirmed && r.tier !== "auto").length;

    const getTierBadge = (tier: MatchTier, confidence: number) => {
        const styles = {
            auto: "bg-[#e6f4ea] text-[#1e8e3e]",
            confirm: "bg-[#fef7e0] text-[#ea8600]",
            manual: "bg-[#fce8e6] text-[#d93025]",
        };
        const labels = {
            auto: `Auto (${confidence}%)`,
            confirm: `Review (${confidence}%)`,
            manual: confidence > 0 ? `Manual (${confidence}%)` : "No Match",
        };
        return (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[tier]}`}>
                {labels[tier]}
            </span>
        );
    };

    return (
        <div className="pb-20 p-4 max-w-2xl mx-auto">
            <h1 className="text-xl font-medium text-[#202124] mb-4">Scan Schedule</h1>

            {/* Upload Area */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`
                    border-2 border-dashed rounded-xl p-8 text-center transition-colors
                    ${isDragging ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-[#dadce0] bg-[#f1f3f4]"}
                `}
            >
                {isProcessing ? (
                    <div>
                        <div className="animate-spin w-10 h-10 border-3 border-[#1a73e8] border-t-transparent rounded-full mx-auto mb-3" />
                        <p className="text-[#3c4043]">Processing image...</p>
                        <p className="text-sm text-[#5f6368] mt-1">Extracting appointments with AI</p>
                    </div>
                ) : (
                    <>
                        <Upload className="w-12 h-12 mx-auto text-[#5f6368] mb-4" />
                        <p className="text-[#3c4043] mb-2">
                            Drag & drop a schedule screenshot
                        </p>
                        <p className="text-sm text-[#5f6368] mb-4">or</p>
                        <div className="flex justify-center gap-3">
                            <label className="cursor-pointer">
                                <Button variant="primary" as="span">
                                    <FileText className="w-4 h-4 mr-2" />
                                    Choose File
                                </Button>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileInput}
                                    className="hidden"
                                />
                            </label>
                            <label className="cursor-pointer">
                                <Button variant="secondary" as="span">
                                    <Camera className="w-4 h-4 mr-2" />
                                    Take Photo
                                </Button>
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleFileInput}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    </>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="mt-4 p-3 bg-[#fce8e6] border border-[#d93025] rounded-lg text-[#d93025] flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {/* Import Success */}
            {importSuccess !== null && (
                <div className="mt-4 p-4 bg-[#e6f4ea] border border-[#1e8e3e] rounded-lg text-[#1e8e3e]">
                    <div className="flex items-center gap-2 mb-2">
                        <Check className="w-5 h-5" />
                        <span className="font-medium">
                            Successfully imported {importSuccess} appointment{importSuccess !== 1 ? "s" : ""}!
                        </span>
                    </div>
                    {importRouteMessage && (
                        <p className="text-sm mb-2 text-[#196d33]">{importRouteMessage}</p>
                    )}
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate("/schedule")}
                    >
                        View Schedule
                    </Button>
                </div>
            )}

            {/* Results */}
            {results.length > 0 && (
                <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-medium text-[#202124]">
                            Extracted Appointments ({results.length})
                        </h2>
                        <div className="text-sm text-[#5f6368]">
                            {confirmedCount} confirmed, {pendingCount} pending
                        </div>
                    </div>

                    {results.map((result, index) => (
                        <Card key={index} className={result.confirmed ? "border-l-4 border-l-[#1e8e3e]" : ""}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-[#202124]">
                                            {result.rawName}
                                        </span>
                                        {result.isMatching ? (
                                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#f1f3f4] text-[#5f6368]">
                                                Matching...
                                            </span>
                                        ) : (
                                            getTierBadge(result.tier, result.confidence)
                                        )}
                                    </div>
                                    <p className="text-sm text-[#5f6368] mt-1">
                                        {result.date} at {result.time} ({result.duration} min)
                                    </p>
                                    {result.visitType && (
                                        <p className="text-sm text-[#5f6368] mt-1">
                                            Visit type: <span className="font-medium">{result.visitType}</span>
                                        </p>
                                    )}
                                    {result.notes && (
                                        <p className="text-sm text-[#5f6368] mt-1 italic">
                                            {result.notes}
                                        </p>
                                    )}
                                </div>

                                {result.confirmed && (
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#1e8e3e] flex items-center justify-center">
                                        <Check className="w-4 h-4 text-white" />
                                    </div>
                                )}
                            </div>

                            {/* Match result */}
                            {result.matchedPatientId && (
                                <div className="mt-3 p-2 bg-[#f1f3f4] rounded flex items-center justify-between">
                                    <span className="text-sm text-[#3c4043]">
                                        Matched: <span className="font-medium">{result.matchedPatientName}</span>
                                    </span>
                                    {!result.confirmed && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleConfirm(index)}
                                                className="p-1.5 rounded-full bg-[#1e8e3e] text-white hover:bg-[#137333] transition-colors"
                                                aria-label="Confirm match"
                                            >
                                                <Check className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleReject(index)}
                                                className="p-1.5 rounded-full bg-[#d93025] text-white hover:bg-[#b31412] transition-colors"
                                                aria-label="Reject match"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Alternatives / Manual selection */}
                            {!result.confirmed && !result.isMatching && (
                                <div className="mt-3">
                                    {result.alternatives.length > 0 && !result.matchedPatientId && (
                                        <div className="mb-2">
                                            <p className="text-sm text-[#5f6368] mb-1">Possible matches:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {result.alternatives.map((alt) => (
                                                    <button
                                                        key={alt.id}
                                                        onClick={() => handleSelectPatient(index, alt.id, alt.name)}
                                                        className="px-3 py-1 text-sm bg-[#e8f0fe] text-[#1a73e8] rounded-full hover:bg-[#d2e3fc] transition-colors"
                                                    >
                                                        {alt.name} ({alt.confidence}%)
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-sm text-[#5f6368] mb-1">
                                            {result.matchedPatientId ? "Or select different patient:" : "Select patient:"}
                                        </p>
                                        <select
                                            value=""
                                            onChange={(e) => {
                                                const selected = patients.find((p) => p.id === e.target.value);
                                                if (selected) {
                                                    handleSelectPatient(index, selected.id, selected.fullName);
                                                }
                                            }}
                                            className="w-full input-google text-sm"
                                        >
                                            <option value="">Choose a patient...</option>
                                            {patients
                                                .filter((p) => p.status === "active")
                                                .map((p) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.fullName}
                                                    </option>
                                                ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {result.uncertain && (
                                <p className="text-[#ea8600] text-sm mt-2 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    Low OCR confidence - please verify
                                </p>
                            )}
                        </Card>
                    ))}

                    {/* Import button */}
                    <div className="flex gap-3 pt-4">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => {
                                setResults([]);
                                setError(null);
                            }}
                        >
                            Clear All
                        </Button>
                        <Button
                            variant="primary"
                            className="flex-1"
                            onClick={handleImportConfirmed}
                            disabled={confirmedCount === 0 || isImporting}
                        >
                            {isImporting
                                ? "Importing..."
                                : `Import ${confirmedCount} Appointment${confirmedCount !== 1 ? "s" : ""}`}
                        </Button>
                    </div>
                </div>
            )}

            {/* Instructions when no results */}
            {results.length === 0 && !isProcessing && !importSuccess && (
                <div className="mt-8 space-y-4">
                    <h2 className="text-lg font-medium text-[#202124]">How it works</h2>
                    <ol className="list-decimal list-inside space-y-2 text-[#3c4043]">
                        <li>Take a screenshot of your schedule (from any source)</li>
                        <li>Upload or drag the image above</li>
                        <li>AI extracts patient names, dates, and times</li>
                        <li>Review and confirm the matched patients</li>
                        <li>Import directly to your schedule</li>
                    </ol>
                </div>
            )}
        </div>
    );
}
