import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePatientStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import {
    parseAlternateContactsField,
    serializeAlternateContactsField,
} from "../api/sheets";
import type { Patient, PatientStatus } from "../types";
import { Phone, MapPin, Navigation, Edit2, X, Trash2 } from "lucide-react";

interface EditFormData {
    fullName: string;
    nicknames: string;
    phone: string;
    alternateContacts: string;
    address: string;
    notes: string;
    status: PatientStatus;
}

export function PatientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { patients, loadAll, update, discharge, markForOtherPt, reactivate, delete: deletePatient } = usePatientStore();
    const [patient, setPatient] = useState<Patient | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<EditFormData | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    useEffect(() => {
        const found = patients.find((p) => p.id === id);
        setPatient(found ?? null);
        if (found) {
            setFormData({
                fullName: found.fullName,
                nicknames: found.nicknames.join(", "),
                phone: found.phone,
                alternateContacts: serializeAlternateContactsField(found.alternateContacts),
                address: found.address,
                notes: found.notes,
                status: found.status,
            });
        }
    }, [id, patients]);

    if (!patient) {
        return (
            <div className="p-4 text-center">
                <p className="text-[var(--color-text-secondary)]">Patient not found</p>
                <Button variant="secondary" className="mt-4" onClick={() => navigate("/patients")}>
                    Back to Patients
                </Button>
            </div>
        );
    }

    const handleStatusToggle = async () => {
        if (patient.status === "active" || patient.status === "evaluation") {
            await discharge(patient.id);
        } else if (patient.status === "for-other-pt") {
            await reactivate(patient.id);
        } else {
            await reactivate(patient.id);
        }
    };

    const handleMarkForOtherPt = async () => {
        await markForOtherPt(patient.id);
    };

    const handleStartEdit = () => {
        setFormData({
            fullName: patient.fullName,
            nicknames: patient.nicknames.join(", "),
            phone: patient.phone,
            alternateContacts: serializeAlternateContactsField(patient.alternateContacts),
            address: patient.address,
            notes: patient.notes,
            status: patient.status,
        });
        setFormError(null);
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setFormError(null);
        setIsEditing(false);
    };

    const handleInputChange = (field: keyof EditFormData, value: string) => {
        setFormData((prev) => prev ? { ...prev, [field]: value } : null);
    };

    const handleSaveEdit = async () => {
        if (!formData) return;

        if (!formData.fullName.trim()) {
            setFormError("Patient name is required.");
            return;
        }

        setIsSaving(true);
        setFormError(null);

        try {
            const changes: Partial<Omit<Patient, "id" | "createdAt">> = {
                fullName: formData.fullName.trim(),
                nicknames: formData.nicknames
                    .split(",")
                    .map((n) => n.trim())
                    .filter(Boolean),
                phone: formData.phone.trim(),
                alternateContacts: parseAlternateContactsField(formData.alternateContacts),
                address: formData.address.trim(),
                notes: formData.notes.trim(),
                status: formData.status,
            };
            if (formData.status === "for-other-pt" && patient.status !== "for-other-pt") {
                changes.forOtherPtAt = new Date();
            } else if (formData.status !== "for-other-pt") {
                changes.forOtherPtAt = undefined;
            }
            await update(patient.id, changes);
            setIsEditing(false);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to update patient.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        const confirmed = window.confirm(
            `Are you sure you want to delete ${patient.fullName}? This cannot be undone.`
        );
        if (!confirmed) return;

        try {
            await deletePatient(patient.id);
            navigate("/patients");
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to delete patient.");
        }
    };

    const buildPhoneHref = (phone?: string) => {
        if (!phone) return null;
        return `tel:${phone.replace(/[^\d+]/g, "")}`;
    };

    if (isEditing && formData) {
        return (
            <div className="pb-20 max-w-2xl mx-auto">
                {/* Edit Header */}
                <div className="bg-[var(--color-surface)] p-4 border-b border-[var(--color-border)] sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handleCancelEdit}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            aria-label="Cancel editing"
                        >
                            <X className="w-6 h-6" />
                        </button>
                        <h1 className="text-lg font-medium text-[var(--color-text-primary)]">Edit Patient</h1>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void handleSaveEdit()}
                            disabled={isSaving}
                        >
                            {isSaving ? "Saving..." : "Save"}
                        </Button>
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                            Full Name *
                        </label>
                        <input
                            type="text"
                            value={formData.fullName}
                            onChange={(e) => handleInputChange("fullName", e.target.value)}
                            className="w-full input-google"
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
                        />
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
                            Address
                        </label>
                        <input
                            type="text"
                            value={formData.address}
                            onChange={(e) => handleInputChange("address", e.target.value)}
                            className="w-full input-google"
                        />
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
                            rows={4}
                        />
                    </div>

                    {formError && (
                        <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
                    )}

                    {/* Danger Zone */}
                    <div className="pt-4 border-t border-[var(--color-border)]">
                        <Button
                            variant="danger"
                            onClick={() => void handleDelete()}
                            className="w-full"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Patient
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="pb-20 max-w-2xl mx-auto">
            {/* Header */}
            <div className="bg-[var(--color-surface)] p-4 border-b border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => navigate("/patients")}
                        className="text-[var(--color-primary)] hover:underline"
                        aria-label="Back to patients"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={handleStartEdit}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                        aria-label="Edit patient"
                    >
                        <Edit2 className="w-5 h-5" />
                    </button>
                </div>
                <h1 className="text-xl font-medium text-[var(--color-text-primary)] mt-2">{patient.fullName}</h1>
                <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium mt-1 ${patient.status === "active"
                            ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300"
                            : patient.status === "evaluation"
                            ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
                            : patient.status === "for-other-pt"
                            ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                            : "bg-[var(--color-border-light)] text-[var(--color-text-secondary)]"
                        }`}
                >
                    {patient.status === "for-other-pt" ? "For Other PT" : patient.status}
                </span>
            </div>

            <div className="p-4 space-y-4">
                {/* Contact Info */}
                <Card>
                    <CardHeader title="Contact" />
                    <div className="space-y-2">
                        {patient.phone ? (
                            <a
                                href={buildPhoneHref(patient.phone)!}
                                className="flex items-center gap-2 text-[var(--color-primary)] hover:underline"
                            >
                                <Phone className="w-4 h-4" />
                                {patient.phone}
                            </a>
                        ) : (
                            <p className="text-[var(--color-text-secondary)] text-sm">No phone number</p>
                        )}
                        {patient.email && (
                            <a
                                href={`mailto:${patient.email}`}
                                className="flex items-center gap-2 text-[var(--color-primary)] hover:underline"
                            >
                                ✉️ {patient.email}
                            </a>
                        )}
                    </div>
                </Card>

                {/* Alternate Contacts */}
                {patient.alternateContacts.length > 0 && (
                    <Card>
                        <CardHeader title="Alternate Contacts" />
                        <div className="space-y-2">
                            {patient.alternateContacts.map((contact, index) => (
                                <div key={index} className="flex items-center justify-between">
                                    <span className="text-[var(--color-text-primary)]">
                                        {contact.firstName}
                                        {contact.relationship && (
                                            <span className="text-[var(--color-text-secondary)] text-sm ml-1">
                                                ({contact.relationship})
                                            </span>
                                        )}
                                    </span>
                                    <a
                                        href={`tel:${contact.phone}`}
                                        className="text-[var(--color-primary)] hover:underline"
                                    >
                                        {contact.phone}
                                    </a>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* Address */}
                {patient.address && (
                    <Card>
                        <CardHeader title="Address" />
                        <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(patient.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[var(--color-text-primary)] hover:text-[var(--color-primary)] hover:underline"
                        >
                            {patient.address}
                        </a>
                        <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(patient.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-2"
                        >
                            <Button size="sm" variant="primary">
                                <Navigation className="w-4 h-4 mr-1" />
                                Navigate
                            </Button>
                        </a>
                    </Card>
                )}

                {/* Nicknames */}
                {patient.nicknames.length > 0 && (
                    <Card>
                        <CardHeader title="Nicknames" />
                        <p className="text-[var(--color-text-primary)]">{patient.nicknames.join(", ")}</p>
                    </Card>
                )}

                {/* Notes */}
                {patient.notes && (
                    <Card>
                        <CardHeader title="Notes" />
                        <p className="text-[var(--color-text-primary)] whitespace-pre-wrap">{patient.notes}</p>
                    </Card>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={handleStartEdit}>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit
                    </Button>
                    {patient.status !== "for-other-pt" && patient.status !== "discharged" && (
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => void handleMarkForOtherPt()}
                        >
                            Other PT
                        </Button>
                    )}
                    <Button
                        variant={patient.status === "active" || patient.status === "evaluation" ? "danger" : "primary"}
                        className="flex-1"
                        onClick={() => void handleStatusToggle()}
                    >
                        {patient.status === "active" || patient.status === "evaluation"
                            ? "Discharge"
                            : "Reactivate"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
