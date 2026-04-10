import { useEffect, useState } from "react";
import { useAppointmentStore } from "../stores";
import { Button } from "./ui/Button";
import { VisitTypeSelect } from "./ui/VisitTypeSelect";
import { X } from "lucide-react";
import type { Patient, VisitType } from "../types";
import {
    PERSONAL_PATIENT_ID,
    PERSONAL_CATEGORIES,
    getPersonalCategoryLabel,
} from "../utils/personalEventColors";
import {
    toLocalIsoDate,
    isValidQuarterHour,
    SLOT_MINUTES,
} from "../utils/scheduling";

interface AddAppointmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    patients: Patient[];
    defaultDate: string;
    defaultTime?: string;
    defaultIsPersonal?: boolean;
    onCreated: (date: string) => void;
}

export function AddAppointmentModal({
    isOpen,
    onClose,
    patients,
    defaultDate,
    defaultTime,
    defaultIsPersonal,
    onCreated,
}: AddAppointmentModalProps) {
    const { create } = useAppointmentStore();

    // Form state — all local to this component
    const [patientId, setPatientId] = useState("");
    const [appointmentDate, setAppointmentDate] = useState(defaultDate);
    const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
    const [duration, setDuration] = useState(60);
    const [visitType, setVisitType] = useState<VisitType>(null);
    const [isPersonalEvent, setIsPersonalEvent] = useState(defaultIsPersonal ?? false);
    const [personalCategory, setPersonalCategory] = useState("lunch");
    const [personalTitle, setPersonalTitle] = useState("");
    const [repeatInterval, setRepeatInterval] = useState<"none" | "weekly" | "biweekly">("none");
    const [repeatUntil, setRepeatUntil] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Initialize/reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setAppointmentDate(defaultDate);
            setStartTime(defaultTime ?? "09:00");
            setDuration(60);
            setVisitType(null);
            setIsPersonalEvent(defaultIsPersonal ?? false);
            setPersonalCategory("lunch");
            setPersonalTitle("");
            setRepeatInterval("none");
            setRepeatUntil("");
            setError(null);
            setIsSaving(false);
        }
    }, [isOpen, defaultDate, defaultTime, defaultIsPersonal]);

    // Auto-select first active patient when patient list changes
    useEffect(() => {
        if (patients.length === 0) {
            setPatientId("");
            return;
        }
        const exists = patients.some((p) => p.id === patientId);
        if (!exists) {
            const firstActive = patients.find(
                (p) => p.status === "active" || p.status === "evaluation"
            );
            setPatientId((firstActive || patients[0]).id);
        }
    }, [patients, patientId]);

    if (!isOpen) return null;

    const handleClose = () => {
        setError(null);
        setIsSaving(false);
        onClose();
    };

    const handleCreate = async () => {
        // Validation
        if (!isPersonalEvent && !patientId) {
            setError("Please select a patient.");
            return;
        }
        if (!appointmentDate) {
            setError("Please choose an appointment date.");
            return;
        }
        if (!isValidQuarterHour(startTime)) {
            setError("Start time must be in 15-minute increments.");
            return;
        }
        if (duration < 15 || duration > 240 || duration % 15 !== 0) {
            setError("Duration must be in 15-minute increments between 15 and 240.");
            return;
        }
        if (isPersonalEvent && repeatInterval !== "none" && !repeatUntil) {
            setError("Please set a 'Repeat until' date for recurring events.");
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            if (isPersonalEvent) {
                const dates: string[] = [appointmentDate];
                if (repeatInterval !== "none" && repeatUntil) {
                    const stepDays = repeatInterval === "weekly" ? 7 : 14;
                    const startDate = new Date(appointmentDate + "T00:00:00");
                    const endDate = new Date(repeatUntil + "T00:00:00");
                    const cur = new Date(startDate);
                    cur.setDate(cur.getDate() + stepDays);
                    while (cur <= endDate) {
                        dates.push(toLocalIsoDate(cur));
                        cur.setDate(cur.getDate() + stepDays);
                    }
                }
                for (const date of dates) {
                    await create({
                        patientId: PERSONAL_PATIENT_ID,
                        date,
                        startTime,
                        duration,
                        visitType: null,
                        personalCategory,
                        title: personalTitle.trim() || undefined,
                        status: "scheduled",
                        syncStatus: "local",
                        notes: undefined,
                    });
                }
            } else {
                await create({
                    patientId,
                    date: appointmentDate,
                    startTime,
                    duration,
                    visitType,
                    status: "scheduled",
                    syncStatus: "local",
                    notes: undefined,
                });
            }
            onCreated(appointmentDate);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add appointment.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={handleClose}
        >
            <div
                className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-md mx-4 animate-slide-in"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                    <h2 className="text-lg font-medium text-[var(--color-text-primary)]">New Appointment</h2>
                    <button
                        onClick={handleClose}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                    >
                        <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Patient / Personal toggle */}
                    <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)]">
                        <button
                            type="button"
                            onClick={() => setIsPersonalEvent(false)}
                            className={`flex-1 py-2 text-sm font-medium transition-colors ${
                                !isPersonalEvent
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                            }`}
                        >
                            Patient
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsPersonalEvent(true)}
                            className={`flex-1 py-2 text-sm font-medium transition-colors ${
                                isPersonalEvent
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                            }`}
                        >
                            Personal
                        </button>
                    </div>

                    {!isPersonalEvent && patients.length === 0 ? (
                        <p className="text-sm text-red-600 dark:text-red-400">
                            Add a patient first before creating appointments.
                        </p>
                    ) : (
                        <>
                            {isPersonalEvent ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Category
                                        </label>
                                        <select
                                            value={personalCategory}
                                            onChange={(e) => setPersonalCategory(e.target.value)}
                                            className="w-full input-google"
                                        >
                                            {PERSONAL_CATEGORIES.map((cat) => (
                                                <option key={cat} value={cat}>
                                                    {getPersonalCategoryLabel(cat)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Title (optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={personalTitle}
                                            onChange={(e) => setPersonalTitle(e.target.value)}
                                            placeholder="e.g., Lunch with Sarah"
                                            className="w-full input-google"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Repeat
                                        </label>
                                        <select
                                            value={repeatInterval}
                                            onChange={(e) => {
                                                const val = e.target.value as "none" | "weekly" | "biweekly";
                                                setRepeatInterval(val);
                                                if (val !== "none" && !repeatUntil) {
                                                    const d = new Date(appointmentDate + "T00:00:00");
                                                    d.setMonth(d.getMonth() + 3);
                                                    setRepeatUntil(toLocalIsoDate(d));
                                                }
                                                if (val === "none") {
                                                    setRepeatUntil("");
                                                }
                                            }}
                                            className="w-full input-google"
                                        >
                                            <option value="none">None</option>
                                            <option value="weekly">Weekly</option>
                                            <option value="biweekly">Every 2 weeks</option>
                                        </select>
                                    </div>

                                    {repeatInterval !== "none" && (
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                                Repeat until
                                            </label>
                                            <input
                                                type="date"
                                                value={repeatUntil}
                                                onChange={(e) => setRepeatUntil(e.target.value)}
                                                min={appointmentDate}
                                                className="w-full input-google"
                                            />
                                            {repeatUntil && (() => {
                                                const stepDays = repeatInterval === "weekly" ? 7 : 14;
                                                const start = new Date(appointmentDate + "T00:00:00");
                                                const end = new Date(repeatUntil + "T00:00:00");
                                                let count = 1;
                                                const cur = new Date(start);
                                                cur.setDate(cur.getDate() + stepDays);
                                                while (cur <= end) { count++; cur.setDate(cur.getDate() + stepDays); }
                                                return (
                                                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                                                        {count} occurrence{count !== 1 ? "s" : ""} will be created
                                                    </p>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                        Patient
                                    </label>
                                    <select
                                        value={patientId}
                                        onChange={(e) => setPatientId(e.target.value)}
                                        className="w-full input-google"
                                    >
                                        {(() => {
                                            const schedulable = [...patients]
                                                .filter((p) => p.id !== PERSONAL_PATIENT_ID && p.status !== "discharged")
                                                .sort((a, b) => a.fullName.localeCompare(b.fullName));
                                            const active = schedulable.filter((p) => p.status !== "for-other-pt");
                                            const otherPt = schedulable.filter((p) => p.status === "for-other-pt");
                                            return (
                                                <>
                                                    <optgroup label="Active Patients">
                                                        {active.map((p) => (
                                                            <option key={p.id} value={p.id}>{p.fullName}</option>
                                                        ))}
                                                    </optgroup>
                                                    {otherPt.length > 0 && (
                                                        <optgroup label="Other PT">
                                                            {otherPt.map((p) => (
                                                                <option key={p.id} value={p.id}>{p.fullName}</option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </select>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                        Date
                                    </label>
                                    <input
                                        type="date"
                                        value={appointmentDate}
                                        onChange={(e) => setAppointmentDate(e.target.value)}
                                        className="w-full input-google"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                        Start Time
                                    </label>
                                    <input
                                        type="time"
                                        step={SLOT_MINUTES * 60}
                                        value={startTime}
                                        onChange={(e) => setStartTime(e.target.value)}
                                        className="w-full input-google"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                    Duration (minutes)
                                </label>
                                <select
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-full input-google"
                                >
                                    {[15, 30, 45, 60, 90, 120].map((d) => (
                                        <option key={d} value={d}>
                                            {d} minutes
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {!isPersonalEvent && (
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                        Visit Type
                                    </label>
                                    <VisitTypeSelect value={visitType} onChange={setVisitType} />
                                </div>
                            )}

                            {error && (
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            )}
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)]">
                    <Button variant="ghost" onClick={handleClose} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => void handleCreate()}
                        disabled={isSaving || (!isPersonalEvent && patients.length === 0)}
                    >
                        {isSaving ? "Saving..." : "Save"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
