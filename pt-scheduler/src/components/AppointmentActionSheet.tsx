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
    onCopy: () => void;
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
    onCopy,
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
                className="bg-[var(--color-surface)] rounded-t-xl shadow-2xl w-full max-w-md mx-4 mb-0 animate-slide-up safe-area-pb max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
                    <h3 className="text-base font-medium text-[var(--color-text-primary)] truncate pr-4">
                        {patientName}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
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
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                                    <Phone className="w-5 h-5 text-[var(--color-primary)]" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Call Patient</span>
                                    <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(patient?.phone)}</span>
                                </div>
                            </a>
                            <button
                                onClick={() => copyToClipboard(patient?.phone ?? '', 'phone')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                                aria-label="Copy phone number"
                            >
                                {copiedKey === 'phone' ? (
                                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Text Patient (Primary) */}
                    {hasPhone && smsHref && (
                        <a
                            href={smsHref}
                            onClick={onClose}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                                <MessageSquare className="w-5 h-5 text-[var(--color-primary)]" />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-medium">Text Patient</span>
                                <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(patient?.phone)}</span>
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
                                            className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                                        >
                                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                                                <Phone className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-medium">Call {contactLabel}</span>
                                                <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(contact.phone)}</span>
                                            </div>
                                        </a>
                                        <button
                                            onClick={() => copyToClipboard(contact.phone, altCopyKey)}
                                            className="p-2.5 mr-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                                            aria-label={`Copy ${contactLabel} phone number`}
                                        >
                                            {copiedKey === altCopyKey ? (
                                                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                            ) : (
                                                <Copy className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* Text Alternate */}
                                {altSmsHref && (
                                    <a
                                        href={altSmsHref}
                                        onClick={onClose}
                                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                                    >
                                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                                            <MessageSquare className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium">Text {contactLabel}</span>
                                            <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(contact.phone)}</span>
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
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                                    <Navigation className="w-5 h-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Navigate to Address</span>
                                    <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[250px]">{patient?.address}</span>
                                </div>
                            </button>
                            <button
                                onClick={() => copyToClipboard(patient?.address ?? '', 'address')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                                aria-label="Copy address"
                            >
                                {copiedKey === 'address' ? (
                                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Divider */}
                    <div className="my-2 border-t border-[var(--color-border)]" />

                    {/* View / Edit Details */}
                    <button
                        onClick={() => {
                            onViewEdit();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-surface-hover)]">
                            <Edit3 className="w-5 h-5 text-[var(--color-text-secondary)]" />
                        </div>
                        <span className="font-medium">View / Edit Details</span>
                    </button>

                    {/* Move Appointment */}
                    <button
                        onClick={() => {
                            onMove();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-100 dark:bg-purple-950">
                            <Move className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <span className="font-medium">Move Appointment</span>
                    </button>

                    {/* Copy Appointment */}
                    <button
                        onClick={() => {
                            onCopy();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-teal-100 dark:bg-teal-950">
                            <Copy className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                        </div>
                        <span className="font-medium">Copy Appointment</span>
                    </button>

                    {/* Delete Appointment */}
                    <button
                        onClick={() => {
                            onDelete();
                            onClose();
                        }}
                        className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                    >
                        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-50 dark:bg-red-950">
                            <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <span className="font-medium text-red-600 dark:text-red-400">Delete Appointment</span>
                    </button>
                </div>

                {/* Cancel button */}
                <div className="p-2 border-t border-[var(--color-border)]">
                    <button
                        onClick={onClose}
                        className="w-full py-3 px-4 text-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
