import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { Phone, MessageSquare, Navigation, Edit3, Move, Trash2, X, Copy, Check, PauseCircle, StickyNote, User } from "lucide-react";
import type { Appointment, Patient } from "../types";
import { isPersonalEvent, getPersonalCategoryLabel } from "../utils/personalEventColors";
import { ChipNoteEditor } from "./appointments/ChipNoteEditor";
import { useChipNoteEditor } from "./appointments/useChipNoteEditor";

interface AppointmentActionSheetProps {
    appointment: Appointment;
    patient: Patient | undefined;
    isOpen: boolean;
    onClose: () => void;
    onNavigate: () => void;
    onViewEdit: () => void;
    onMove: () => void;
    onCopy: () => void;
    onHold: () => void;
    onChipNote: (notes: string[], color?: string) => void;
    onPatientChipNote: (notes: string[], color?: string) => void;
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
    onHold,
    onChipNote,
    onPatientChipNote,
    onDelete,
}: AppointmentActionSheetProps) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [chipNoteMode, setChipNoteMode] = useState(false);
    const [lastAppointmentId, setLastAppointmentId] = useState(appointment?.id);
    const isPersonal = isPersonalEvent(appointment);

    const chipNoteEditor = useChipNoteEditor(appointment, patient, {
        onChipNote,
        onPatientChipNote,
    });

    // Reset local state when the appointment changes so stale data doesn't
    // persist. The editor resets its own state on the same signal.
    if (appointment?.id !== lastAppointmentId) {
        setLastAppointmentId(appointment?.id);
        setChipNoteMode(false);
    }

    const saveNotes = () => {
        chipNoteEditor.save();
        onClose();
    };

    // Clean up copy timer on unmount
    useEffect(() => {
        return () => {
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
        };
    }, []);

    const copyToClipboard = useCallback(async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedKey(key);
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1500);
        } catch {
            // Clipboard write failed — do not show success indicator
        }
    }, []);

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

    if (!isOpen) {
        return null;
    }

    const headerName = isPersonal
        ? (appointment.title || getPersonalCategoryLabel(appointment.personalCategory))
        : (patient?.fullName ?? "Unknown Patient");
    const primaryPhone = !isPersonal ? patient?.phoneNumbers[0]?.number : undefined;
    const hasPhone = Boolean(primaryPhone);
    const hasAddress = !isPersonal && Boolean(patient?.address);
    const alternateContacts = isPersonal ? [] : (patient?.alternateContacts ?? []);

    const phoneHref = buildPhoneHref(primaryPhone);
    const smsHref = buildSmsHref(primaryPhone);

    const noteCount = chipNoteMode
        ? chipNoteEditor.notes.length
        : chipNoteEditor.effectiveNotes.length;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                className="bg-[var(--color-surface)] rounded-t-xl shadow-2xl w-full max-w-md mx-4 mb-0 animate-slide-up safe-area-pb max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
                    <h3 className="text-base font-medium text-[var(--color-text-primary)] truncate pr-4">
                        {headerName}
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
                    {/* Primary patient contact */}
                    {hasPhone && (() => {
                        const primaryActions: ContactRowAction[] = [];
                        if (phoneHref) {
                            primaryActions.push({
                                key: "call-primary",
                                icon: <Phone className="w-5 h-5" />,
                                ariaLabel: "Call patient",
                                onClick: () => {
                                    onClose();
                                    window.location.href = phoneHref;
                                },
                            });
                        }
                        if (smsHref) {
                            primaryActions.push({
                                key: "text-primary",
                                icon: <MessageSquare className="w-5 h-5" />,
                                ariaLabel: "Text patient",
                                onClick: () => {
                                    onClose();
                                    window.location.href = smsHref;
                                },
                            });
                        }
                        primaryActions.push({
                            key: "phone",
                            icon: <Copy className="w-4 h-4" />,
                            ariaLabel: "Copy phone number",
                            copyable: true,
                            onClick: () => copyToClipboard(primaryPhone ?? "", "phone"),
                        });
                        return (
                            <ContactRow
                                role="primary"
                                leadIcon={<Phone className="w-4 h-4" />}
                                primaryText={patient?.fullName ?? "Patient"}
                                secondaryText={formatPhoneDisplay(primaryPhone)}
                                copiedKey={copiedKey}
                                actions={primaryActions}
                            />
                        );
                    })()}

                    {/* Alternate Contacts */}
                    {alternateContacts.map((contact, index) => {
                        const altPhoneHref = buildPhoneHref(contact.phone);
                        const altSmsHref = buildSmsHref(contact.phone);
                        if (!altPhoneHref && !altSmsHref) return null;

                        const label = contact.firstName + (contact.relationship ? ` · ${contact.relationship}` : "");
                        const altCopyKey = `alt-phone-${index}`;

                        const actions: ContactRowAction[] = [];
                        if (altPhoneHref) {
                            actions.push({
                                key: `alt-call-${index}`,
                                icon: <Phone className="w-5 h-5" />,
                                ariaLabel: `Call ${label}`,
                                onClick: () => {
                                    onClose();
                                    window.location.href = altPhoneHref;
                                },
                            });
                        }
                        if (altSmsHref) {
                            actions.push({
                                key: `alt-text-${index}`,
                                icon: <MessageSquare className="w-5 h-5" />,
                                ariaLabel: `Text ${label}`,
                                onClick: () => {
                                    onClose();
                                    window.location.href = altSmsHref;
                                },
                            });
                        }
                        actions.push({
                            key: altCopyKey,
                            icon: <Copy className="w-4 h-4" />,
                            ariaLabel: `Copy ${label} phone number`,
                            copyable: true,
                            onClick: () => copyToClipboard(contact.phone, altCopyKey),
                        });

                        return (
                            <ContactRow
                                key={`alt-${index}`}
                                role="alt"
                                leadIcon={<User className="w-4 h-4" />}
                                primaryText={label}
                                secondaryText={formatPhoneDisplay(contact.phone)}
                                copiedKey={copiedKey}
                                actions={actions}
                            />
                        );
                    })}

                    {/* Address */}
                    {hasAddress && (
                        <ContactRow
                            role="address"
                            leadIcon={<Navigation className="w-4 h-4" />}
                            primaryText={patient?.address ?? ""}
                            copiedKey={copiedKey}
                            actions={[
                                {
                                    key: "navigate",
                                    icon: <Navigation className="w-5 h-5" />,
                                    ariaLabel: "Navigate to address",
                                    onClick: () => {
                                        onNavigate();
                                        onClose();
                                    },
                                },
                                {
                                    key: "address",
                                    icon: <Copy className="w-4 h-4" />,
                                    ariaLabel: "Copy address",
                                    copyable: true,
                                    onClick: () => copyToClipboard(patient?.address ?? "", "address"),
                                },
                            ]}
                        />
                    )}

                    {/* Divider */}
                    <div className="my-2 border-t border-[var(--color-border)]" />

                    {/* Icon action bar */}
                    <div className="grid grid-cols-6 gap-1 px-1 pt-1">
                        <IconBarButton
                            tint="neutral"
                            icon={<Edit3 className="w-5 h-5" />}
                            label="Edit"
                            ariaLabel="View / Edit Details"
                            onClick={() => {
                                onViewEdit();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="purple"
                            icon={<Move className="w-5 h-5" />}
                            label="Move"
                            ariaLabel="Move Appointment"
                            onClick={() => {
                                onMove();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="teal"
                            icon={<Copy className="w-5 h-5" />}
                            label="Copy"
                            ariaLabel="Copy Appointment"
                            onClick={() => {
                                onCopy();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="amber"
                            icon={<StickyNote className="w-5 h-5" />}
                            label={noteCount > 0 ? "Notes" : "Note"}
                            ariaLabel={noteCount > 0 ? "Edit Notes" : "Add Quick Note"}
                            onClick={() => setChipNoteMode(true)}
                        />
                        <IconBarButton
                            tint="amber"
                            icon={<PauseCircle className="w-5 h-5" />}
                            label="Hold"
                            ariaLabel="Put on Hold"
                            onClick={() => {
                                onHold();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="red"
                            icon={<Trash2 className="w-5 h-5" />}
                            label="Delete"
                            ariaLabel="Delete Appointment"
                            labelDanger
                            onClick={() => {
                                onDelete();
                                onClose();
                            }}
                        />
                    </div>

                    {/* Note inline expansion — reveals below the icon bar when Note tapped */}
                    {chipNoteMode && (
                        <div className="px-4 py-3 mt-2 border-t border-[var(--color-border)]">
                            <ChipNoteEditor
                                editor={chipNoteEditor}
                                onSave={saveNotes}
                                onRemovedFromAll={onClose}
                                autoFocus
                            />
                        </div>
                    )}
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

// ---------- Private helpers ----------

type ContactRole = "primary" | "alt" | "address";

interface ContactRowAction {
    key: string;
    icon: ReactNode;
    onClick: () => void;
    ariaLabel: string;
    /** When set, renders a green check instead of the icon if copiedKey === key */
    copyable?: boolean;
}

interface ContactRowProps {
    role: ContactRole;
    /** Icon rendered in the left badge (a Lucide icon element) */
    leadIcon: ReactNode;
    /** First line (e.g. "John Smith" or "Mary · wife" or "1420 Oak Lane") */
    primaryText: string;
    /** Second line (phone number or address line 2) — optional */
    secondaryText?: string;
    actions: ContactRowAction[];
    copiedKey: string | null;
}

function ContactRow({
    role,
    leadIcon,
    primaryText,
    secondaryText,
    actions,
    copiedKey,
}: ContactRowProps) {
    const badgeClass =
        role === "primary"
            ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
            : role === "alt"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-500 dark:text-amber-400"
            : "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400";

    const actionBtnClass =
        role === "primary"
            ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] hover:brightness-95"
            : role === "alt"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900"
            : "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900";

    const copyBtnClass =
        "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:brightness-95";

    return (
        <div className="flex items-center gap-3 py-2 px-3">
            <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${badgeClass}`}>
                {leadIcon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {primaryText}
                </div>
                {secondaryText && (
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        {secondaryText}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
                {actions.map((action) => {
                    const showCheck = action.copyable && copiedKey === action.key;
                    const isCopy = action.copyable === true;
                    return (
                        <button
                            key={action.key}
                            type="button"
                            onClick={action.onClick}
                            aria-label={action.ariaLabel}
                            title={action.ariaLabel}
                            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                                isCopy ? copyBtnClass : actionBtnClass
                            }`}
                        >
                            {showCheck ? (
                                <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                            ) : (
                                action.icon
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface IconBarButtonProps {
    icon: ReactNode;
    label: string;
    ariaLabel: string;
    onClick: () => void;
    /** One of the preset tint slots */
    tint: "neutral" | "purple" | "teal" | "amber" | "red";
    /** Label color overrides (used for Delete) */
    labelDanger?: boolean;
}

function IconBarButton({
    icon,
    label,
    ariaLabel,
    onClick,
    tint,
    labelDanger,
}: IconBarButtonProps) {
    const circleClass =
        tint === "neutral"
            ? "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
            : tint === "purple"
            ? "bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400"
            : tint === "teal"
            ? "bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400"
            : tint === "amber"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
            : "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400";

    const labelClass = labelDanger
        ? "text-red-600 dark:text-red-400"
        : "text-[var(--color-text-secondary)]";

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={ariaLabel}
            className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
        >
            <div className={`w-[38px] h-[38px] rounded-full flex items-center justify-center ${circleClass}`}>
                {icon}
            </div>
            <span className={`text-[11px] font-medium leading-tight ${labelClass}`}>
                {label}
            </span>
        </button>
    );
}
