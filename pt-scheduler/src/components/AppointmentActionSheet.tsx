import { useState, useCallback } from "react";
import { Phone, MessageSquare, Navigation, Edit3, Move, Trash2, X, Copy, Check } from "lucide-react";
import type { Appointment, Patient } from "../types";

interface AppointmentActionSheetProps {
    appointment: Appointment;
    patient: Patient | undefined;
    isOpen: boolean;
    onClose: () => void;
    onNavigate: () => void;
    onViewEdit: () => void;
    onMove: () => void;
    onDelete: () => void;
}

const buildPhoneHref = (rawPhone?: string): string | null => {
    if (!rawPhone) return null;
    const trimmed = rawPhone.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[^\d+]/g, "");
    return normalized ? `tel:${normalized}` : null;
};

const buildSmsHref = (rawPhone?: string): string | null => {
    if (!rawPhone) return null;
    const trimmed = rawPhone.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[^\d+]/g, "");
    return normalized ? `sms:${normalized}` : null;
};

const formatPhoneDisplay = (rawPhone?: string): string => {
    if (!rawPhone) return "";
    const trimmed = rawPhone.trim();
    // Try to format as (xxx) xxx-xxxx if it's 10 digits
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith("1")) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return trimmed;
};

export function AppointmentActionSheet({
    appointment,
    patient,
    isOpen,
    onClose,
    onNavigate,
    onViewEdit,
    onMove,
    onDelete,
}: AppointmentActionSheetProps) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const copyToClipboard = useCallback((text: string, key: string) => {
        void navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
    }, []);

    if (!isOpen) {
        return null;
    }

    const patientName = patient?.fullName ?? "Unknown Patient";
    const hasPhone = Boolean(patient?.phone);
    const hasAddress = Boolean(patient?.address);
    const alternateContacts = patient?.alternateContacts ?? [];

    const phoneHref = buildPhoneHref(patient?.phone);
    const smsHref = buildSmsHref(patient?.phone);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-t-xl shadow-2xl w-full max-w-md mx-4 mb-0 animate-slide-up safe-area-pb max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#dadce0] sticky top-0 bg-white">
                    <h3 className="text-base font-medium text-[#202124] truncate pr-4">
                        {patientName}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-[#f1f3f4] transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-[#5f6368]" />
                    </button>
                </div>

                {/* Action buttons */}
                <div className="p-2">
                    {/* Call Patient (Primary) */}
                    {hasPhone && phoneHref && (
                        <div className="flex items-center">
                            <a
                                href={phoneHref}
                                onClick={onClose}
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e8f0fe]">
                                    <Phone className="w-5 h-5 text-[#1a73e8]" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Call Patient</span>
                                    <span className="text-sm text-[#5f6368]">{formatPhoneDisplay(patient?.phone)}</span>
                                </div>
                            </a>
                            <button
                                onClick={() => copyToClipboard(patient?.phone ?? '', 'phone')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[#f1f3f4] transition-colors"
                                aria-label="Copy phone number"
                            >
                                {copiedKey === 'phone' ? (
                                    <Check className="w-4 h-4 text-[#1e8e3e]" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[#5f6368]" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Text Patient (Primary) */}
                    {hasPhone && smsHref && (
                        <a
                            href={smsHref}
                            onClick={onClose}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e8f0fe]">
                                <MessageSquare className="w-5 h-5 text-[#1a73e8]" />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-medium">Text Patient</span>
                                <span className="text-sm text-[#5f6368]">{formatPhoneDisplay(patient?.phone)}</span>
                            </div>
                        </a>
                    )}

                    {/* Alternate Contacts */}
                    {alternateContacts.map((contact, index) => {
                        const altPhoneHref = buildPhoneHref(contact.phone);
                        const altSmsHref = buildSmsHref(contact.phone);
                        const contactLabel = contact.firstName + (contact.relationship ? ` (${contact.relationship})` : "");
                        const altCopyKey = `alt-phone-${index}`;

                        return (
                            <div key={index}>
                                {/* Call Alternate */}
                                {altPhoneHref && (
                                    <div className="flex items-center">
                                        <a
                                            href={altPhoneHref}
                                            onClick={onClose}
                                            className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                                        >
                                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#fef7e0]">
                                                <Phone className="w-5 h-5 text-[#f9ab00]" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-medium">Call {contactLabel}</span>
                                                <span className="text-sm text-[#5f6368]">{formatPhoneDisplay(contact.phone)}</span>
                                            </div>
                                        </a>
                                        <button
                                            onClick={() => copyToClipboard(contact.phone, altCopyKey)}
                                            className="p-2.5 mr-2 rounded-full hover:bg-[#f1f3f4] transition-colors"
                                            aria-label={`Copy ${contactLabel} phone number`}
                                        >
                                            {copiedKey === altCopyKey ? (
                                                <Check className="w-4 h-4 text-[#1e8e3e]" />
                                            ) : (
                                                <Copy className="w-4 h-4 text-[#5f6368]" />
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* Text Alternate */}
                                {altSmsHref && (
                                    <a
                                        href={altSmsHref}
                                        onClick={onClose}
                                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                                    >
                                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#fef7e0]">
                                            <MessageSquare className="w-5 h-5 text-[#f9ab00]" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium">Text {contactLabel}</span>
                                            <span className="text-sm text-[#5f6368]">{formatPhoneDisplay(contact.phone)}</span>
                                        </div>
                                    </a>
                                )}
                            </div>
                        );
                    })}

                    {/* Navigate to Address */}
                    {hasAddress && (
                        <div className="flex items-center">
                            <button
                                onClick={() => {
                                    onNavigate();
                                    onClose();
                                }}
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e6f4ea]">
                                    <Navigation className="w-5 h-5 text-[#1e8e3e]" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Navigate to Address</span>
                                    <span className="text-sm text-[#5f6368] truncate max-w-[250px]">{patient?.address}</span>
                                </div>
                            </button>
                            <button
                                onClick={() => copyToClipboard(patient?.address ?? '', 'address')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[#f1f3f4] transition-colors"
                                aria-label="Copy address"
                            >
                                {copiedKey === 'address' ? (
                                    <Check className="w-4 h-4 text-[#1e8e3e]" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[#5f6368]" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Divider */}
                    <div className="my-2 border-t border-[#dadce0]" />

                    {/* View / Edit Details */}
                    <button
                        onClick={() => {
                            onViewEdit();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#f1f3f4]">
                            <Edit3 className="w-5 h-5 text-[#5f6368]" />
                        </div>
                        <span className="font-medium">View / Edit Details</span>
                    </button>

                    {/* Move Appointment */}
                    <button
                        onClick={() => {
                            onMove();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#f1f3f4] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#f3e8fd]">
                            <Move className="w-5 h-5 text-[#8e24aa]" />
                        </div>
                        <span className="font-medium">Move Appointment</span>
                    </button>

                    {/* Delete Appointment */}
                    <button
                        onClick={() => {
                            onDelete();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[#202124] hover:bg-[#fce8e6] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#fce8e6]">
                            <Trash2 className="w-5 h-5 text-[#d93025]" />
                        </div>
                        <span className="font-medium text-[#d93025]">Delete Appointment</span>
                    </button>
                </div>

                {/* Cancel button */}
                <div className="p-2 border-t border-[#dadce0]">
                    <button
                        onClick={onClose}
                        className="w-full py-3 px-4 text-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-lg font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
