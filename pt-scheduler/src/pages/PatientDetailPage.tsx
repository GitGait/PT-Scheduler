import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePatientStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import type { Patient, PatientStatus } from "../types";
import { Phone, MapPin, Navigation, Edit2, X, Trash2 } from "lucide-react";

interface EditFormData {
    fullName: string;
    nicknames: string;
    phone: string;
    address: string;
    notes: string;
    status: PatientStatus;
}

export function PatientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { patients, loadAll, update, discharge, reactivate, delete: deletePatient } = usePatientStore();
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
                address: found.address,
                notes: found.notes,
                status: found.status,
            });
        }
    }, [id, patients]);

    if (!patient) {
        return (
            <div className="p-4 text-center">
                <p className="text-[#5f6368]">Patient not found</p>
                <Button variant="secondary" className="mt-4" onClick={() => navigate("/patients")}>
                    Back to Patients
                </Button>
            </div>
        );
    }

    const handleStatusToggle = async () => {
        if (patient.status === "active") {
            await discharge(patient.id);
        } else {
            await reactivate(patient.id);
        }
    };

    const handleStartEdit = () => {
        setFormData({
            fullName: patient.fullName,
            nicknames: patient.nicknames.join(", "),
            phone: patient.phone,
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
            await update(patient.id, {
                fullName: formData.fullName.trim(),
                nicknames: formData.nicknames
                    .split(",")
                    .map((n) => n.trim())
                    .filter(Boolean),
                phone: formData.phone.trim(),
                address: formData.address.trim(),
                notes: formData.notes.trim(),
                status: formData.status,
            });
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
                <div className="bg-white p-4 border-b border-[#dadce0] sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handleCancelEdit}
                            className="text-[#5f6368] hover:text-[#202124]"
                            aria-label="Cancel editing"
                        >
                            <X className="w-6 h-6" />
                        </button>
                        <h1 className="text-lg font-medium text-[#202124]">Edit Patient</h1>
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                        <p className="text-sm text-[#d93025]">{formError}</p>
                    )}

                    {/* Danger Zone */}
                    <div className="pt-4 border-t border-[#dadce0]">
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
            <div className="bg-white p-4 border-b border-[#dadce0]">
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => navigate("/patients")}
                        className="text-[#1a73e8] hover:underline"
                        aria-label="Back to patients"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={handleStartEdit}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] text-[#5f6368]"
                        aria-label="Edit patient"
                    >
                        <Edit2 className="w-5 h-5" />
                    </button>
                </div>
                <h1 className="text-xl font-medium text-[#202124] mt-2">{patient.fullName}</h1>
                <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium mt-1 ${patient.status === "active"
                            ? "bg-[#e6f4ea] text-[#1e8e3e]"
                            : patient.status === "evaluation"
                            ? "bg-[#fef7e0] text-[#ea8600]"
                            : "bg-[#e8eaed] text-[#5f6368]"
                        }`}
                >
                    {patient.status}
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
                                className="flex items-center gap-2 text-[#1a73e8] hover:underline"
                            >
                                <Phone className="w-4 h-4" />
                                {patient.phone}
                            </a>
                        ) : (
                            <p className="text-[#5f6368] text-sm">No phone number</p>
                        )}
                        {patient.email && (
                            <a
                                href={`mailto:${patient.email}`}
                                className="flex items-center gap-2 text-[#1a73e8] hover:underline"
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
                                    <span className="text-[#3c4043]">
                                        {contact.firstName}
                                        {contact.relationship && (
                                            <span className="text-[#5f6368] text-sm ml-1">
                                                ({contact.relationship})
                                            </span>
                                        )}
                                    </span>
                                    <a
                                        href={`tel:${contact.phone}`}
                                        className="text-[#1a73e8] hover:underline"
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
                            className="block text-[#3c4043] hover:text-[#1a73e8] hover:underline"
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
                        <p className="text-[#3c4043]">{patient.nicknames.join(", ")}</p>
                    </Card>
                )}

                {/* Notes */}
                {patient.notes && (
                    <Card>
                        <CardHeader title="Notes" />
                        <p className="text-[#3c4043] whitespace-pre-wrap">{patient.notes}</p>
                    </Card>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={handleStartEdit}>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit
                    </Button>
                    <Button
                        variant={patient.status === "active" ? "danger" : "primary"}
                        className="flex-1"
                        onClick={handleStatusToggle}
                    >
                        {patient.status === "active" ? "Discharge" : "Reactivate"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
