import { useState, useEffect, useRef } from "react";
import { X, Phone, MapPin, Clock, FileText, Save, Loader2, Tag, Users, Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/Button";
import type { Appointment, Patient, VisitType } from "../types";
import type { AlternateContact } from "../utils/validation";
import { VisitTypeSelect } from "./ui/VisitTypeSelect";
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
    onSyncToSheet?: (patient: Patient) => Promise<void>;
}

export function AppointmentDetailModal({
    appointment,
    patient,
    isOpen,
    onClose,
    onSavePatient,
    onSaveAppointment,
    onSyncToSheet,
}: AppointmentDetailModalProps) {
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState("");
    const [notes, setNotes] = useState("");
    const [visitType, setVisitType] = useState<VisitType>(null);
    const [altContacts, setAltContacts] = useState<AlternateContact[]>([]);
    const [personalTitle, setPersonalTitle] = useState("");
    const [personalCategory, setPersonalCategory] = useState("other");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
            setPhone(patient.phone || "");
            setAddress(patient.address || "");
            setAltContacts(patient.alternateContacts?.length ? [...patient.alternateContacts] : []);
        }
        setNotes(appointment.notes || "");
        setVisitType(appointment.visitType ?? null);
        setPersonalTitle(appointment.title || "");
        setPersonalCategory(appointment.personalCategory || "other");
        setError(null);
        setSuccessMessage(null);
    }, [patient, appointment, isOpen]);

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

        try {
            if (isPersonal) {
                const titleChanged = personalTitle !== (appointment.title || "");
                const categoryChanged = personalCategory !== (appointment.personalCategory || "other");
                const notesChanged = notes !== (appointment.notes || "");

                if (titleChanged || categoryChanged || notesChanged) {
                    await onSaveAppointment(appointment.id, {
                        title: personalTitle.trim() || undefined,
                        personalCategory,
                        notes: notes || undefined,
                    });
                    setSuccessMessage("Changes saved successfully!");
                    setTimeout(() => {
                        onClose();
                    }, 1000);
                } else {
                    onClose();
                }
            } else {
                // Filter out empty alternate contacts
                const cleanedContacts = altContacts.filter(c => c.firstName.trim() && c.phone.trim());

                // Check if patient data changed
                const altContactsChanged = JSON.stringify(cleanedContacts) !== JSON.stringify(patient!.alternateContacts ?? []);
                const patientChanged = phone !== patient!.phone || address !== patient!.address || altContactsChanged;
                const visitTypeChanged = visitType !== (appointment.visitType ?? null);
                const appointmentChanged = notes !== (appointment.notes || "") || visitTypeChanged;

                if (patientChanged) {
                    await onSavePatient(patient!.id, {
                        phone,
                        address,
                        alternateContacts: cleanedContacts,
                    });

                    if (onSyncToSheet) {
                        const updatedPatient: Patient = {
                            ...patient!,
                            phone,
                            address,
                            alternateContacts: cleanedContacts,
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
                    setTimeout(() => {
                        onClose();
                    }, 1000);
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
                        </>
                    ) : (
                        <>
                            {/* Phone */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                                    <Phone className="w-4 h-4" />
                                    Phone Number
                                </label>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="Enter phone number"
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
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] sticky bottom-0 bg-[var(--color-surface)]">
                    <Button variant="ghost" onClick={onClose} disabled={isSaving}>
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
    );
}
