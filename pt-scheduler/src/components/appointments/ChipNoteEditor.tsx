import { X, Plus, Pencil } from "lucide-react";
import { CHIP_NOTE_COLORS, CHIP_NOTE_SWATCH_HEX } from "../../utils/chipNoteColors";
import { MAX_CHIP_NOTES, type ChipNoteEditorState } from "./useChipNoteEditor";

interface ChipNoteEditorProps {
    editor: ChipNoteEditorState;
    /** Renders the editor's own Save button. Omit when the parent has a footer save. */
    onSave?: () => void;
    /** Called when "Remove from all" actually fires (after the confirm tap). */
    onRemovedFromAll?: () => void;
    autoFocus?: boolean;
    placeholder?: string;
}

/**
 * Note list + color picker + apply-to-all, shared by the appointment action
 * sheet and the appointment detail modal.
 */
export function ChipNoteEditor({
    editor,
    onSave,
    onRemovedFromAll,
    autoFocus = false,
    placeholder = "e.g., Call 15 min before",
}: ChipNoteEditorProps) {
    const {
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
        removeFromAll,
    } = editor;

    const handleRemoveFromAll = () => {
        if (removeFromAll()) {
            onRemovedFromAll?.();
        }
    };

    return (
        <div className="space-y-2">
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
                        placeholder={placeholder}
                        autoFocus={autoFocus}
                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (newNoteText.trim()) {
                                    addNote();
                                } else {
                                    onSave?.();
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

            {/* Color picker */}
            <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-[var(--color-text-secondary)]">Color</span>
                <div className="flex gap-1.5">
                    {CHIP_NOTE_COLORS.map((color) => (
                        <button
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            className={`w-5 h-5 rounded-full border-2 transition-transform ${
                                selectedColor === color
                                    ? "scale-110 border-[var(--color-text-primary)]"
                                    : "border-transparent hover:scale-105"
                            }`}
                            style={{ backgroundColor: CHIP_NOTE_SWATCH_HEX[color] }}
                            title={color}
                            aria-label={`${color} note color`}
                        />
                    ))}
                </div>
            </div>

            {/* Remove from all */}
            {!isPersonal && hasPatientNotes && (
                <div className="flex pt-1">
                    <button
                        onClick={handleRemoveFromAll}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            confirmingRemoveAll
                                ? "bg-red-500 text-white hover:bg-red-600"
                                : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
                        }`}
                    >
                        {confirmingRemoveAll ? "Confirm?" : "Remove from all"}
                    </button>
                </div>
            )}

            {/* Apply to all + Save */}
            <div className="flex items-center justify-between gap-2 pt-1">
                {!isPersonal && (
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={applyToAll}
                            onChange={(e) => changeApplyToAll(e.target.checked)}
                            className="w-4 h-4 rounded border-[var(--color-border)] text-amber-500 focus:ring-amber-400 accent-amber-500"
                        />
                        <span className="text-sm text-[var(--color-text-secondary)]">Apply to all</span>
                    </label>
                )}
                {onSave && (
                    <button
                        onClick={onSave}
                        className="ml-auto px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
                    >
                        Save
                    </button>
                )}
            </div>

            {effectiveNotes.length > 0 && (
                <p className="text-[11px] text-[var(--color-text-tertiary)] px-1 italic">
                    {noteFromPatient ? "Notes from patient record" : "Notes on this appointment"}
                </p>
            )}
        </div>
    );
}
