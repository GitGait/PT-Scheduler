import { useState, useEffect, useRef, useCallback } from "react";
import { X, Phone, MapPin, Clock, FileText, Save, Loader2, Tag, Users, Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/Button";
import type { Appointment, Patient, VisitType } from "../types";
import type { AlternateContact } from "../utils/validation";
import { VisitTypeSelect } from "./ui/VisitTypeSelect";
import { appointmentDB } from "../db/operations";
import {
    isPersonalEvent,
    PERSONAL_CATEGORIES,
    getPersonalCategoryLabel,
} from "../utils/personalEventColors";

interface AppointmentDetailModalProps {
    appointment: Appointment;
    patient: Patient | undefined;
    isOpen: boolean;
    onClose: () => void;
    onSavePatient: (patientId: string, changes: Partial<Patient>) => Promise<void>;
    onSaveAppointment: (appointmentId: string, changes: Partial<Appointment>) => Promise<void>;
    onDeleteAppointment?: (appointmentId: string) => Promise<void>;
    onSyncToSheet?: (patient: Patient) => Promise<void>;
}

export function AppointmentDetailModal({
    appointment,
    patient,
    isOpen,
    onClose,
    onSavePatient,
    onSaveAppointment,
    onDeleteAppointment,
    onSyncToSheet,
}: AppointmentDetailModalProps) {
    const [phoneNumbers, setPhoneNumbers] = useState<{ number: string; label: string }[]>([{ number: "", label: "" }]);
    const [address, setAddress] = useState("");
    const [nicknames, setNicknames] = useState("");
    const [facilityName, setFacilityName] = useState("");
    const [notes, setNotes] = useState("");
    const [visitType, setVisitType] = useState<VisitType>(null);
    const [altContacts, setAltContacts] = useState<AlternateContact[]>([]);
    const [personalTitle, setPersonalTitle] = useState("");
    const [personalAddress, setPersonalAddress] = useState("");
    const [personalCategory, setPersonalCategory] = useState("other");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [siblingCount, setSiblingCount] = useState(0);
    const [applyAddressToAll, setApplyAddressToAll] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState<"this" | "all" | null>(null);

    const isPersonal = isPersonalEvent(appointment);
    const initializedRef = useRef(false);

    // Initialize form values once when modal opens — gated by ref so
    // background sync refreshing patient/appointment props won't overwrite edits
    useEffect(() => {
        if (!isOpen) {
            initializedRef.current = false;
            return;
        }
        if (initializedRef.current) {
            return;
        }
        initializedRef.current = true;

        if (patient) {
            setPhoneNumbers(
                patient.phoneNumbers.length > 0
                    ? patient.phoneNumbers.map((pn) => ({ number: pn.number, label: pn.label ?? "" }))
                    : [{ number: "", label: "" }]
            );
            setAddress(patient.address || "");
            setNicknames(patient.nicknames?.join(", ") || "");
            setFacilityName(patient.facilityName || "");
            setAltContacts(patient.alternateContacts?.length ? [...patient.alternateContacts] : []);
        }
        setNotes(appointment.notes || "");
        setVisitType(appointment.visitType ?? null);
        setPersonalTitle(appointment.title || "");
        setPersonalAddress(appointment.address || "");
        setPersonalCategory(appointment.personalCategory || "other");
        setError(null);
        setSuccessMessage(null);
        setSiblingCount(0);
        setApplyAddressToAll(false);
        setConfirmingDelete(null);

        if (isPersonalEvent(appointment)) {
            const appointmentId = appointment.id;
            appointmentDB.findRecurringSiblings(appointment).then((siblings) => {
                // Guard against stale results if modal was reopened with a different appointment
                if (appointmentId !== appointment.id) return;
                setSiblingCount(siblings.length);
                setApplyAddressToAll(siblings.length > 0);
            }).catch(() => {
                // Silently ignore — siblings just won't be available
            });
        }
    }, [patient, appointment, isOpen]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    // Track auto-close timer so it can be cleaned up
    const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            if (autoCloseTimerRef.current) {
                clearTimeout(autoCloseTimerRef.current);
            }
        };
    }, []);

    const scheduleAutoClose = useCallback(() => {
        if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
        }
        autoCloseTimerRef.current = setTimeout(() => {
            onClose();
        }, 1000);
    }, [onClose]);

    if (!isOpen) {
        return null;
    }

    const handleSave = async () => {
        if (!isPersonal && !patient) {
            setError("Patient not found");
            return;
        }

        setIsSaving(true);
        setError(null);
        setSuccessMessage(null);
        setConfirmingDelete(null);

        try {
            if (isPersonal) {
                const titleChanged = personalTitle !== (appointment.title || "");
                const addressChanged = personalAddress.trim() !== (appointment.address || "");
                const categoryChanged = personalCategory !== (appointment.personalCategory || "other");
                const notesChanged = notes !== (appointment.notes || "");

                if (titleChanged || addressChanged || categoryChanged || notesChanged) {
                    await onSaveAppointment(appointment.id, {
                        title: personalTitle.trim(),
                        address: personalAddress.trim() || undefined,
                        personalCategory,
                        notes: notes || undefined,
                    });

                    // Update all recurring siblings if checkbox is checked
                    if (addressChanged && applyAddressToAll) {
                        const siblings = await appointmentDB.findRecurringSiblings(appointment);
                        try {
                            for (const sibling of siblings) {
                                await onSaveAppointment(sibling.id, {
                                    address: personalAddress.trim() || undefined,
                                });
                            }
                        } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to update some occurrences");
                            return; // Keep modal open so user sees the error
                        }
                    }

                    setSuccessMessage("Changes saved successfully!");
                    scheduleAutoClose();
                } else {
                    onClose();
                }
            } else {
                // Filter out empty alternate contacts
                const cleanedContacts = altContacts.filter(c => c.firstName.trim() && c.phone.trim());

                // Check if patient data changed
                const cleanedPhones = phoneNumbers
                    .filter((pn) => pn.number.trim())
                    .map((pn) => {
                        const label = pn.label.trim();
                        return label ? { number: pn.number.trim(), label } : { number: pn.number.trim() };
                    });
                const phonesChanged = JSON.stringify(cleanedPhones) !== JSON.stringify(patient!.phoneNumbers ?? []);
                const altContactsChanged = JSON.stringify(cleanedContacts) !== JSON.stringify(patient!.alternateContacts ?? []);
                const nicknamesArray = nicknames.split(",").map(n => n.trim()).filter(Boolean);
                const nicknamesChanged = JSON.stringify(nicknamesArray) !== JSON.stringify(patient!.nicknames ?? []);
                const facilityChanged = facilityName.trim() !== (patient!.facilityName || "");
                const patientChanged = phonesChanged || address !== patient!.address || altContactsChanged || nicknamesChanged || facilityChanged;
                const visitTypeChanged = visitType !== (appointment.visitType ?? null);
                const appointmentChanged = notes !== (appointment.notes || "") || visitTypeChanged;

                if (patientChanged) {
                    await onSavePatient(patient!.id, {
                        phoneNumbers: cleanedPhones,
                        address,
                        alternateContacts: cleanedContacts,
                        nicknames: nicknamesArray,
                        facilityName: facilityName.trim() || undefined,
                    });

                    if (onSyncToSheet) {
                        const updatedPatient: Patient = {
                            ...patient!,
                            phoneNumbers: cleanedPhones,
                            address,
                            alternateContacts: cleanedContacts,
                            nicknames: nicknamesArray,
                            facilityName: facilityName.trim() || undefined,
                        };
                        await onSyncToSheet(updatedPatient);
                    }
                }

                if (appointmentChanged) {
                    await onSaveAppointment(appointment.id, {
                        notes: notes || undefined,
                        visitType: visitType,
                    });
                }

                if (patientChanged || appointmentChanged) {
                    setSuccessMessage("Changes saved successfully!");
                    scheduleAutoClose();
                } else {
                    onClose();
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save changes");
        } finally {
            setIsSaving(false);
        }
    };

    const formatTime = (time: string) => {
        const [hours, minutes] = time.split(":");
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? "PM" : "AM";
        const hour12 = ((hour + 11) % 12) + 1;
        return `${hour12}:${minutes} ${ampm}`;
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(`${dateStr}T12:00:00`);
        return date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
        });
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-slide-in"
                onClick={(event) => event.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
                    <h2 className="text-lg font-medium text-[var(--color-text-primary)]">
                        {isPersonal ? "Event Details" : "Appointment Details"}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Header: Name + Time */}
                    <div>
                        <h3 className="text-xl font-medium text-[var(--color-text-primary)]">
                            {isPersonal
                                ? (appointment.title || getPersonalCategoryLabel(appointment.personalCategory))
                                : (patient?.fullName || "Unknown Patient")}
                        </h3>
                        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                            <Clock className="w-4 h-4 inline mr-1" />
                            {formatDate(appointment.date)} at {formatTime(appointment.startTime)}
                            {" "}({appointment.duration} min)
                        </p>
                    </div>

                    {isPersonal ? (
                        <>
                            {/* Title */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <FileText className="w-4 h-4" />
                                    Title
                                </label>
                                <input
                                    type="text"
                                    value={personalTitle}
                                    onChange={(e) => setPersonalTitle(e.target.value)}
                                    placeholder="e.g., Lunch with Sarah"
                                    className="w-full input-google"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Tag className="w-4 h-4" />
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

                            {/* Address */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <MapPin className="w-4 h-4" />
                                    Address
                                </label>
                                <input
                                    type="text"
                                    value={personalAddress}
                                    onChange={(e) => setPersonalAddress(e.target.value)}
                                    placeholder="e.g., 123 Main St, City, ST"
                                    className="w-full input-google"
                                />
                                {siblingCount > 0 && (
                                    <label className="flex items-center gap-2 mt-1.5 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={applyAddressToAll}
                                            onChange={(e) => setApplyAddressToAll(e.target.checked)}
                                            className="rounded"
                                        />
                                        Apply to all {siblingCount + 1} occurrences
                                    </label>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Nicknames */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Tag className="w-4 h-4" />
                                    Nicknames
                                </label>
                                <input
                                    type="text"
                                    value={nicknames}
                                    onChange={(e) => setNicknames(e.target.value)}
                                    placeholder="e.g., Bob, Bobby (comma-separated)"
                                    className="w-full input-google"
                                />
                            </div>

                            {/* Phone Numbers */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Phone className="w-4 h-4" />
                                    Phone Numbers
                                </label>
                                <div className="space-y-2">
                                    {phoneNumbers.map((pn, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <input
                                                type="text"
                                                value={pn.label}
                                                onChange={(e) => {
                                                    const updated = [...phoneNumbers];
                                                    updated[idx] = { ...updated[idx], label: e.target.value };
                                                    setPhoneNumbers(updated);
                                                }}
                                                placeholder="Label"
                                                className="w-[30%] input-google text-sm"
                                            />
                                            <input
                                                type="tel"
                                                value={pn.number}
                                                onChange={(e) => {
                                                    const updated = [...phoneNumbers];
                                                    updated[idx] = { ...updated[idx], number: e.target.value };
                                                    setPhoneNumbers(updated);
                                                }}
                                                placeholder="Phone number"
                                                className="flex-1 input-google text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (phoneNumbers.length <= 1) {
                                                        setPhoneNumbers([{ number: "", label: "" }]);
                                                    } else {
                                                        setPhoneNumbers(phoneNumbers.filter((_, i) => i !== idx));
                                                    }
                                                }}
                                                className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                                                aria-label="Remove phone number"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-500" />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setPhoneNumbers([...phoneNumbers, { number: "", label: "" }])}
                                        className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors py-1"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Phone
                                    </button>
                                </div>
                            </div>

                            {/* Facility Name */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <MapPin className="w-4 h-4" />
                                    Facility Name
                                </label>
                                <input
                                    type="text"
                                    value={facilityName}
                                    onChange={(e) => setFacilityName(e.target.value)}
                                    placeholder="e.g., Sunrise Senior Living (optional)"
                                    className="w-full input-google"
                                />
                            </div>

                            {/* Address */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <MapPin className="w-4 h-4" />
                                    Address
                                </label>
                                <input
                                    type="text"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    placeholder="Enter address"
                                    className="w-full input-google"
                                />
                            </div>

                            {/* Alternate Contacts */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Users className="w-4 h-4" />
                                    Alternate Contacts
                                </label>
                                <div className="space-y-3">
                                    {altContacts.map((contact, index) => (
                                        <div key={index} className="flex gap-2 items-start">
                                            <div className="flex-1 grid grid-cols-3 gap-2">
                                                <input
                                                    type="text"
                                                    value={contact.firstName}
                                                    onChange={(e) => {
                                                        const updated = [...altContacts];
                                                        updated[index] = { ...updated[index], firstName: e.target.value };
                                                        setAltContacts(updated);
                                                    }}
                                                    placeholder="Name"
                                                    className="input-google text-sm"
                                                />
                                                <input
                                                    type="tel"
                                                    value={contact.phone}
                                                    onChange={(e) => {
                                                        const updated = [...altContacts];
                                                        updated[index] = { ...updated[index], phone: e.target.value };
                                                        setAltContacts(updated);
                                                    }}
                                                    placeholder="Phone"
                                                    className="input-google text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    value={contact.relationship || ""}
                                                    onChange={(e) => {
                                                        const updated = [...altContacts];
                                                        updated[index] = { ...updated[index], relationship: e.target.value };
                                                        setAltContacts(updated);
                                                    }}
                                                    placeholder="Relation"
                                                    className="input-google text-sm"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setAltContacts(altContacts.filter((_, i) => i !== index))}
                                                className="p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors mt-1"
                                                aria-label="Remove contact"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setAltContacts([...altContacts, { firstName: "", phone: "" }])}
                                        className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors py-1"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Contact
                                    </button>
                                </div>
                            </div>

                            {/* Visit Type */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Tag className="w-4 h-4" />
                                    Visit Type
                                </label>
                                <VisitTypeSelect value={visitType} onChange={setVisitType} />
                            </div>
                        </>
                    )}

                    {/* Notes */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                            <FileText className="w-4 h-4" />
                            {isPersonal ? "Notes" : "Appointment Notes"}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={isPersonal ? "Add notes..." : "Add notes for this appointment..."}
                            rows={4}
                            className="w-full input-google resize-none"
                            style={{ height: "auto", minHeight: "100px" }}
                        />
                    </div>

                    {/* Error message */}
                    {error && (
                        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 p-3 rounded">
                            {error}
                        </p>
                    )}

                    {/* Success message */}
                    {successMessage && (
                        <p className="text-sm text-green-700 bg-green-50 p-3 rounded">
                            {successMessage}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-between px-6 py-4 border-t border-[var(--color-border)] sticky bottom-0 bg-[var(--color-surface)]">
                    {isPersonal && onDeleteAppointment ? (
                        <div className="flex gap-1">
                            <button
                                type="button"
                                disabled={isSaving}
                                className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                    confirmingDelete === "this"
                                        ? "text-white bg-red-600 hover:bg-red-700"
                                        : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                }`}
                                onClick={async () => {
                                    if (confirmingDelete !== "this") {
                                        setConfirmingDelete("this");
                                        return;
                                    }
                                    setIsSaving(true);
                                    setError(null);
                                    try {
                                        await onDeleteAppointment(appointment.id);
                                        onClose();
                                    } catch (err) {
                                        setError(err instanceof Error ? err.message : "Failed to delete");
                                    } finally {
                                        setIsSaving(false);
                                    }
                                }}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {confirmingDelete === "this" ? "Confirm?" : "Delete"}
                            </button>
                            {siblingCount > 0 && (
                                <button
                                    type="button"
                                    disabled={isSaving}
                                    className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                        confirmingDelete === "all"
                                            ? "text-white bg-red-600 hover:bg-red-700"
                                            : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                    }`}
                                    onClick={async () => {
                                        if (confirmingDelete !== "all") {
                                            setConfirmingDelete("all");
                                            return;
                                        }
                                        setIsSaving(true);
                                        setError(null);
                                        try {
                                            const siblings = await appointmentDB.findRecurringSiblings(appointment);
                                            for (const sibling of siblings) {
                                                await onDeleteAppointment(sibling.id);
                                            }
                                            await onDeleteAppointment(appointment.id);
                                            onClose();
                                        } catch (err) {
                                            setError(err instanceof Error ? err.message : "Failed to delete events");
                                        } finally {
                                            setIsSaving(false);
                                        }
                                    }}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    {confirmingDelete === "all" ? "Confirm?" : `Delete All (${siblingCount + 1})`}
                                </button>
                            )}
                        </div>
                    ) : <div />}
                    <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setConfirmingDelete(null); onClose(); }} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Changes
                            </>
                        )}
                    </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
