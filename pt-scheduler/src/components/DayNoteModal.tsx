import { useState } from "react";
import { X, Trash2, Pencil, Check } from "lucide-react";
import type { DayNote, DayNoteColor } from "../types";
import { getDayNoteColor, DAY_NOTE_COLORS } from "../utils/dayNoteColors";
import { format, parseISO } from "date-fns";

interface DayNoteModalProps {
    date: string;
    notes: DayNote[];
    onClose: () => void;
    onCreate: (note: { date: string; text: string; color: DayNoteColor; startMinutes: number }) => Promise<void>;
    onUpdate: (id: string, changes: { text?: string; color?: DayNoteColor }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    prefillStartMinutes?: number;
}

export function DayNoteModal({ date, notes, onClose, onCreate, onUpdate, onDelete, prefillStartMinutes }: DayNoteModalProps) {
    const [newText, setNewText] = useState("");
    const [newColor, setNewColor] = useState<DayNoteColor>("yellow");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState("");
    const [editColor, setEditColor] = useState<DayNoteColor>("yellow");

    const dateLabel = format(parseISO(date), "EEEE, MMM d");

    const handleAdd = async () => {
        const trimmed = newText.trim();
        if (!trimmed) return;
        await onCreate({ date, text: trimmed, color: newColor, startMinutes: prefillStartMinutes ?? 720 });
        setNewText("");
        setNewColor("yellow");
    };

    const startEdit = (note: DayNote) => {
        setEditingId(note.id);
        setEditText(note.text);
        setEditColor(note.color);
    };

    const saveEdit = async () => {
        if (!editingId) return;
        const trimmed = editText.trim();
        if (!trimmed) return;
        await onUpdate(editingId, { text: trimmed, color: editColor });
        setEditingId(null);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div
                className="relative w-full max-w-md max-h-[80vh] bg-[var(--color-surface)] rounded-xl shadow-xl border border-[var(--color-border)] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                        Notes — {dateLabel}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Notes list */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {notes.length === 0 && (
                        <p className="text-xs text-[var(--color-text-tertiary)] text-center py-4">
                            No notes for this day yet.
                        </p>
                    )}
                    {notes.map((note) => {
                        const colors = getDayNoteColor(note.color);
                        const isEditing = editingId === note.id;

                        if (isEditing) {
                            return (
                                <div
                                    key={note.id}
                                    className="rounded-lg p-3 border-2"
                                    style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                                >
                                    <textarea
                                        value={editText}
                                        onChange={(e) => setEditText(e.target.value)}
                                        className="w-full bg-transparent text-sm resize-none outline-none min-h-[60px]"
                                        style={{ color: colors.text }}
                                        autoFocus
                                    />
                                    <div className="flex items-center justify-between mt-2">
                                        <ColorPicker selected={editColor} onChange={setEditColor} />
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="px-2 py-1 text-xs rounded hover:bg-black/10"
                                                style={{ color: colors.text }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => void saveEdit()}
                                                className="px-2 py-1 text-xs rounded bg-black/10 hover:bg-black/20 flex items-center gap-1"
                                                style={{ color: colors.text }}
                                            >
                                                <Check size={12} /> Save
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={note.id}
                                className="group rounded-lg p-3 border cursor-pointer transition-shadow hover:shadow-sm"
                                style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                                onClick={() => startEdit(note)}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm whitespace-pre-wrap flex-1">{note.text}</p>
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                startEdit(note);
                                            }}
                                            className="p-1 rounded hover:bg-black/10"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void onDelete(note.id);
                                            }}
                                            className="p-1 rounded hover:bg-black/10"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Add note section */}
                <div className="border-t border-[var(--color-border-light)] px-4 py-3">
                    <textarea
                        value={newText}
                        onChange={(e) => setNewText(e.target.value)}
                        placeholder="Add a note..."
                        className="w-full bg-[var(--color-bg)] text-[var(--color-text-primary)] text-sm rounded-lg border border-[var(--color-border)] px-3 py-2 resize-none outline-none focus:border-[var(--color-primary)] min-h-[60px]"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                void handleAdd();
                            }
                        }}
                    />
                    <div className="flex items-center justify-between mt-2">
                        <ColorPicker selected={newColor} onChange={setNewColor} />
                        <button
                            onClick={() => void handleAdd()}
                            disabled={!newText.trim()}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                        >
                            Add Note
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ColorPicker({ selected, onChange }: { selected: DayNoteColor; onChange: (c: DayNoteColor) => void }) {
    const colorSwatches: Record<DayNoteColor, string> = {
        yellow: "#facc15",
        blue: "#60a5fa",
        green: "#4ade80",
        pink: "#f472b6",
        purple: "#c084fc",
        orange: "#fb923c",
    };

    return (
        <div className="flex gap-1.5">
            {DAY_NOTE_COLORS.map((color) => (
                <button
                    key={color}
                    onClick={() => onChange(color)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                        selected === color ? "scale-110 border-[var(--color-text-primary)]" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: colorSwatches[color] }}
                    title={color}
                />
            ))}
        </div>
    );
}
