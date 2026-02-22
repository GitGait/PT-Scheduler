import { useState, useCallback, useRef, useEffect } from "react";
import { Phone, MessageSquare, Navigation, Edit3, Move, Trash2, X, Copy, Check, PauseCircle, StickyNote, Plus, Pencil } from "lucide-react";
import type { Appointment, Patient } from "../types";
import { isPersonalEvent, getPersonalCategoryLabel } from "../utils/personalEventColors";

const MAX_CHIP_NOTES = 4;

/** Merge chipNotes array + legacy chipNote into a single array */
function mergeChipNotes(chipNotes?: string[], chipNote?: string): string[] {
    const notes = [...(chipNotes ?? [])];
    if (chipNote && !notes.includes(chipNote)) {
        notes.push(chipNote);
    }
    return notes;
}

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
    onChipNote: (notes: string[]) => void;
    onPatientChipNote: (notes: string[]) => void;
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
    const [chipNoteMode, setChipNoteMode] = useState(false);
    const isPersonal = isPersonalEvent(appointment);

    // Merge existing notes from both old and new fields
    const appointmentNotes = mergeChipNotes(appointment.chipNotes, appointment.chipNote);
    const patientNotes = mergeChipNotes(patient?.chipNotes, patient?.chipNote);
    const hasPatientNotes = patientNotes.length > 0;
    const hasAppointmentNotes = appointmentNotes.length > 0;
    const noteFromPatient = !hasAppointmentNotes && hasPatientNotes;

    // The effective notes are appointment-level if they exist, else patient-level
    const effectiveNotes = hasAppointmentNotes ? appointmentNotes : patientNotes;
    const [notes, setNotes] = useState<string[]>(effectiveNotes);
    const [newNoteText, setNewNoteText] = useState("");
    const [applyToAll, setApplyToAll] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingText, setEditingText] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);

    const copyToClipboard = useCallback((text: string, key: string) => {
        void navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
    }, []);

    const addNote = () => {
        const trimmed = newNoteText.trim();
        if (!trimmed || notes.length >= MAX_CHIP_NOTES) return;
        setNotes([...notes, trimmed]);
        setNewNoteText("");
    };

    const removeNote = (index: number) => {
        setNotes(notes.filter((_, i) => i !== index));
        if (editingIndex === index) {
            setEditingIndex(null);
        } else if (editingIndex !== null && editingIndex > index) {
            setEditingIndex(editingIndex - 1);
        }
    };

    const startEditing = (index: number) => {
        setEditingIndex(index);
        setEditingText(notes[index]);
    };

    const commitEdit = () => {
        if (editingIndex === null) return;
        const trimmed = editingText.trim();
        if (trimmed) {
            setNotes(notes.map((n, i) => i === editingIndex ? trimmed : n));
        }
        setEditingIndex(null);
    };

    const cancelEdit = () => {
        setEditingIndex(null);
    };

    useEffect(() => {
        if (editingIndex !== null && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingIndex]);

    const saveNotes = () => {
        let finalNotes = notes;
        const trimmed = newNoteText.trim();
        if (trimmed && finalNotes.length < MAX_CHIP_NOTES) {
            finalNotes = [...finalNotes, trimmed];
        }
        if (applyToAll && !isPersonal) {
            onPatientChipNote(finalNotes);
        } else {
            onChipNote(finalNotes);
        }
        onClose();
    };

    if (!isOpen) {
        return null;
    }

    const headerName = isPersonal
        ? (appointment.title || getPersonalCategoryLabel(appointment.personalCategory))
        : (patient?.fullName ?? "Unknown Patient");
    const hasPhone = !isPersonal && Boolean(patient?.phone);
    const hasAddress = !isPersonal && Boolean(patient?.address);
    const alternateContacts = isPersonal ? [] : (patient?.alternateContacts ?? []);

    const phoneHref = buildPhoneHref(patient?.phone);
    const smsHref = buildSmsHref(patient?.phone);

    const noteCount = effectiveNotes.length;
    const notePreview = noteCount > 0
        ? (noteCount === 1 ? effectiveNotes[0] : `${noteCount} notes`)
        : "";

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

                    {/* Quick Notes */}
                    {chipNoteMode ? (
                        <div className="px-4 py-3 space-y-2">
                            {/* Existing notes list */}
                            {notes.length > 0 && (
                                <div className="space-y-1">
                                    {notes.map((note, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg px-3 py-1.5"
                                        >
                                            {editingIndex === index ? (
                                                <input
                                                    ref={editInputRef}
                                                    type="text"
                                                    value={editingText}
                                                    onChange={(e) => setEditingText(e.target.value)}
                                                    onBlur={commitEdit}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            commitEdit();
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEdit();
                                                        }
                                                    }}
                                                    className="flex-1 text-sm text-[var(--color-text-primary)] bg-white dark:bg-amber-900/50 rounded px-2 py-0.5 border border-amber-300 dark:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                                />
                                            ) : (
                                                <button
                                                    onClick={() => startEditing(index)}
                                                    className="flex-1 flex items-center gap-1.5 text-left min-w-0 group"
                                                >
                                                    <span className="text-sm text-[var(--color-text-primary)] truncate">{note}</span>
                                                    <Pencil className="w-3 h-3 text-amber-400 dark:text-amber-600 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => removeNote(index)}
                                                className="p-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors shrink-0"
                                                aria-label={`Remove note: ${note}`}
                                            >
                                                <X className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add note input */}
                            {notes.length < MAX_CHIP_NOTES ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={newNoteText}
                                        onChange={(e) => setNewNoteText(e.target.value)}
                                        placeholder="e.g., Call 15 min before"
                                        autoFocus
                                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (newNoteText.trim()) {
                                                    addNote();
                                                } else {
                                                    saveNotes();
                                                }
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={addNote}
                                        disabled={!newNoteText.trim()}
                                        className="p-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Add note"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
                                    Max {MAX_CHIP_NOTES} notes reached
                                </p>
                            )}

                            {/* Apply to all + Save */}
                            <div className="flex items-center justify-between gap-2 pt-1">
                                {!isPersonal && (
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={applyToAll}
                                            onChange={(e) => setApplyToAll(e.target.checked)}
                                            className="w-4 h-4 rounded border-[var(--color-border)] text-amber-500 focus:ring-amber-400 accent-amber-500"
                                        />
                                        <span className="text-sm text-[var(--color-text-secondary)]">Apply to all</span>
                                    </label>
                                )}
                                <button
                                    onClick={saveNotes}
                                    className="ml-auto px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
                                >
                                    Save
                                </button>
                            </div>

                            {effectiveNotes.length > 0 && (
                                <p className="text-[11px] text-[var(--color-text-tertiary)] px-1 italic">
                                    {noteFromPatient ? "Notes from patient record" : "Notes on this appointment"}
                                </p>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setChipNoteMode(true)}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                                <StickyNote className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <span className="font-medium">{noteCount > 0 ? "Edit Notes" : "Quick Note"}</span>
                            {notePreview && (
                                <span className="ml-auto text-sm text-[var(--color-text-secondary)] truncate max-w-[140px]">{notePreview}</span>
                            )}
                        </button>
                    )}

                    {/* Put on Hold */}
                    {appointment.status !== "on-hold" && (
                        <button
                            onClick={() => {
                                onHold();
                                onClose();
                            }}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-amber-50 dark:hover:bg-amber-950 rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                                <PauseCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <span className="font-medium text-amber-600 dark:text-amber-400">Put on Hold</span>
                        </button>
                    )}

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
