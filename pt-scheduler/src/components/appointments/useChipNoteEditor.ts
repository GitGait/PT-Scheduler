import { useState, useRef, useEffect } from "react";
import type { Appointment, Patient } from "../../types";
import { isPersonalEvent } from "../../utils/personalEventColors";

export const MAX_CHIP_NOTES = 4;

/** Merge chipNotes array + legacy chipNote into a single array */
export function mergeChipNotes(chipNotes?: string[], chipNote?: string): string[] {
    const notes = [...(chipNotes ?? [])];
    if (chipNote && !notes.includes(chipNote)) {
        notes.push(chipNote);
    }
    return notes;
}

interface UseChipNoteEditorOptions {
    onChipNote: (notes: string[], color?: string) => void;
    onPatientChipNote: (notes: string[], color?: string) => void;
    /**
     * Prefills the "add note" input when the appointment has no chip notes yet.
     * Used to surface pre-existing Appointment.notes text so it isn't stranded.
     */
    seedNewNoteText?: string;
}

export type ChipNoteEditorState = ReturnType<typeof useChipNoteEditor>;

/**
 * Editing state for an appointment's chip notes, shared by the long-press
 * action sheet and the appointment detail modal so both write the same data
 * with the same options.
 */
export function useChipNoteEditor(
    appointment: Appointment,
    patient: Patient | undefined,
    options: UseChipNoteEditorOptions
) {
    const isPersonal = isPersonalEvent(appointment);

    const appointmentNotes = mergeChipNotes(appointment.chipNotes, appointment.chipNote);
    const patientNotes = mergeChipNotes(patient?.chipNotes, patient?.chipNote);
    const hasPatientNotes = patientNotes.length > 0;
    const hasAppointmentNotes = appointmentNotes.length > 0;
    const noteFromPatient = !hasAppointmentNotes && hasPatientNotes;

    // The effective notes are appointment-level if they exist, else patient-level
    const effectiveNotes = hasAppointmentNotes ? appointmentNotes : patientNotes;
    const effectiveColor = hasAppointmentNotes
        ? (appointment.chipNoteColor ?? "yellow")
        : (patient?.chipNoteColor ?? "yellow");

    const seed = effectiveNotes.length === 0 ? (options.seedNewNoteText ?? "") : "";

    const [notes, setNotes] = useState<string[]>(effectiveNotes);
    const [newNoteText, setNewNoteText] = useState(seed);
    const [selectedColor, setSelectedColor] = useState<string>(effectiveColor);
    // Editing a note that lives on the patient record must write back to the
    // patient — otherwise deleting it only clears the (already empty)
    // appointment and the patient's copy re-renders unchanged.
    const [applyToAll, setApplyToAll] = useState(noteFromPatient && !isPersonal);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingText, setEditingText] = useState("");
    const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false);
    const [lastAppointmentId, setLastAppointmentId] = useState(appointment?.id);
    const editInputRef = useRef<HTMLInputElement>(null);

    // Reset local state when the appointment changes so stale data doesn't persist
    if (appointment?.id !== lastAppointmentId) {
        setLastAppointmentId(appointment?.id);
        setNotes(effectiveNotes);
        setNewNoteText(seed);
        setSelectedColor(effectiveColor);
        setApplyToAll(noteFromPatient && !isPersonal);
        setEditingIndex(null);
        setConfirmingRemoveAll(false);
    }

    useEffect(() => {
        if (editingIndex !== null && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingIndex]);

    // Auto-disarm the "Remove from all" confirmation after 3s so a stale armed
    // state can't fire on a later tap.
    useEffect(() => {
        if (!confirmingRemoveAll) return;
        const timer = setTimeout(() => setConfirmingRemoveAll(false), 3000);
        return () => clearTimeout(timer);
    }, [confirmingRemoveAll]);

    const addNote = () => {
        const trimmed = newNoteText.trim();
        if (!trimmed || notes.length >= MAX_CHIP_NOTES) return;
        setNotes([...notes, trimmed]);
        setNewNoteText("");
        setConfirmingRemoveAll(false);
    };

    const removeNote = (index: number) => {
        setNotes(notes.filter((_, i) => i !== index));
        if (editingIndex === index) {
            setEditingIndex(null);
        } else if (editingIndex !== null && editingIndex > index) {
            setEditingIndex(editingIndex - 1);
        }
        setConfirmingRemoveAll(false);
    };

    const startEditing = (index: number) => {
        setEditingIndex(index);
        setEditingText(notes[index]);
        setConfirmingRemoveAll(false);
    };

    const commitEdit = () => {
        if (editingIndex === null) return;
        const trimmed = editingText.trim();
        if (trimmed) {
            setNotes(notes.map((n, i) => (i === editingIndex ? trimmed : n)));
        }
        setEditingIndex(null);
    };

    const cancelEdit = () => {
        setEditingIndex(null);
    };

    const changeApplyToAll = (next: boolean) => {
        setApplyToAll(next);
        setConfirmingRemoveAll(false);
    };

    /** Persist the current list. Callers close their own surface afterwards. */
    const save = () => {
        let finalNotes = notes;
        const trimmed = newNoteText.trim();
        if (trimmed && finalNotes.length < MAX_CHIP_NOTES) {
            finalNotes = [...finalNotes, trimmed];
        }
        if (applyToAll && !isPersonal) {
            options.onPatientChipNote(finalNotes, selectedColor);
        } else {
            options.onChipNote(finalNotes, selectedColor);
        }
    };

    /** Two-tap confirm. Returns true when the removal actually fired. */
    const removeFromAll = (): boolean => {
        if (!confirmingRemoveAll) {
            setConfirmingRemoveAll(true);
            return false;
        }
        options.onPatientChipNote([], undefined);
        return true;
    };

    return {
        isPersonal,
        notes,
        newNoteText,
        setNewNoteText,
        selectedColor,
        setSelectedColor,
        applyToAll,
        changeApplyToAll,
        editingIndex,
        editingText,
        setEditingText,
        editInputRef,
        confirmingRemoveAll,
        hasPatientNotes,
        noteFromPatient,
        effectiveNotes,
        addNote,
        removeNote,
        startEditing,
        commitEdit,
        cancelEdit,
        save,
        removeFromAll,
    };
}
