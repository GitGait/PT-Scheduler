import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePatientStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Search, Phone, MapPin, X, Plus, Navigation } from "lucide-react";
import type { PatientStatus } from "../types";

interface PatientFormData {
    fullName: string;
    nicknames: string;
    phone: string;
    address: string;
    notes: string;
    status: PatientStatus;
}

const emptyForm: PatientFormData = {
    fullName: "",
    nicknames: "",
    phone: "",
    address: "",
    notes: "",
    status: "active",
};

export function PatientsPage() {
    const { patients, loadAll, search, loading, add } = usePatientStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [showDischarged, setShowDischarged] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [formData, setFormData] = useState<PatientFormData>(emptyForm);
    const [formError, setFormError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

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

    const filteredPatients = patients.filter((p) =>
        showDischarged ? p.status === "discharged" : p.status === "active"
    );

    const handleOpenAdd = () => {
        setFormData(emptyForm);
        setFormError(null);
        setIsAddOpen(true);
    };

    const handleCloseAdd = () => {
        setFormError(null);
        setIsAddOpen(false);
    };

    const handleInputChange = (field: keyof PatientFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        if (!formData.fullName.trim()) {
            setFormError("Patient name is required.");
            return;
        }

        setIsSaving(true);
        setFormError(null);

        try {
            await add({
                fullName: formData.fullName.trim(),
                nicknames: formData.nicknames
                    .split(",")
                    .map((n) => n.trim())
                    .filter(Boolean),
                phone: formData.phone.trim(),
                alternateContacts: [],
                address: formData.address.trim(),
                status: formData.status,
                notes: formData.notes.trim(),
            });
            setIsAddOpen(false);
            setFormData(emptyForm);
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
            <div className="sticky top-0 bg-white z-10 px-4 py-3 border-b border-[#dadce0]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#5f6368]" />
                    <input
                        type="search"
                        placeholder="Search patients..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[#f1f3f4] border-none rounded-lg text-[#202124] placeholder-[#5f6368] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]"
                    />
                </div>
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={() => setShowDischarged(false)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!showDischarged
                                ? "bg-[#e8f0fe] text-[#1a73e8]"
                                : "bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]"
                            }`}
                    >
                        Active ({patients.filter((p) => p.status === "active").length})
                    </button>
                    <button
                        onClick={() => setShowDischarged(true)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${showDischarged
                                ? "bg-[#e8f0fe] text-[#1a73e8]"
                                : "bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]"
                            }`}
                    >
                        Discharged ({patients.filter((p) => p.status === "discharged").length})
                    </button>
                </div>
            </div>

            {/* Patients List */}
            <div className="p-4 space-y-3">
                {loading ? (
                    <div className="text-center py-12">
                        <p className="text-[#5f6368]">Loading patients...</p>
                    </div>
                ) : filteredPatients.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-[#5f6368] mb-4">
                            {searchQuery ? "No patients found" : "No patients yet"}
                        </p>
                        <Button variant="primary" onClick={handleOpenAdd}>
                            <Plus className="w-4 h-4 mr-1" />
                            Add Patient
                        </Button>
                    </div>
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
                                        className="inline-flex items-center gap-1 text-[#1a73e8] text-sm hover:underline"
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
                                        className="inline-flex items-center gap-1 text-[#1a73e8] text-sm hover:underline"
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
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[#1a73e8] text-white shadow-lg hover:shadow-xl hover:bg-[#1557b0] transition-all flex items-center justify-center"
                aria-label="Add patient"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Add Patient Modal */}
            {isAddOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
                    <div className="bg-white rounded-lg shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto animate-slide-in">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#dadce0] sticky top-0 bg-white">
                            <h2 className="text-lg font-medium text-[#202124]">Add Patient</h2>
                            <button
                                onClick={handleCloseAdd}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4]"
                            >
                                <X className="w-5 h-5 text-[#5f6368]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                                <p className="text-xs text-[#5f6368] mt-1">
                                    Comma-separated list for matching
                                </p>
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
                                    placeholder="555-123-4567"
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
                                    placeholder="123 Main St, Boise, ID 83702"
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
                                    rows={3}
                                    placeholder="Any relevant notes..."
                                />
                            </div>

                            {formError && (
                                <p className="text-sm text-[#d93025]">{formError}</p>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#dadce0] sticky bottom-0 bg-white">
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
