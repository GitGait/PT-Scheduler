import { useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import type { VisitTypeConfig } from "../../utils/visitTypeColors";
import { isValidVisitTypeColor, MAX_VISIT_TYPE_LABEL_LENGTH } from "../../utils/visitTypeCodes";
import { VisitTypeColorPicker } from "./VisitTypeColorPicker";

interface VisitTypeEditorRowProps {
    config: VisitTypeConfig;
    isBuiltIn: boolean;
    /** True when a stored row exists — i.e. the built-in has been customized. */
    hasOverride: boolean;
    onSave: (changes: { label: string; bg: string }) => void;
    onToggleHidden: () => void;
    /** Built-ins: reset to default. Custom types: delete entirely. */
    onRemove: () => void;
}

export function VisitTypeEditorRow({
    config,
    isBuiltIn,
    hasOverride,
    onSave,
    onToggleHidden,
    onRemove,
}: VisitTypeEditorRowProps) {
    const code = config.code ?? "";
    const [label, setLabel] = useState(config.label);
    const [showPicker, setShowPicker] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    // Adopt external changes (e.g. a sheet sync landing while Settings is open)
    // without clobbering an in-progress edit.
    useEffect(() => {
        setLabel(config.label);
    }, [config.label]);

    const commitLabel = () => {
        const trimmed = label.trim();
        if (!trimmed || trimmed === config.label) {
            setLabel(config.label);
            return;
        }
        onSave({ label: trimmed.slice(0, MAX_VISIT_TYPE_LABEL_LENGTH), bg: config.bg });
    };

    const commitColor = (bg: string) => {
        if (!isValidVisitTypeColor(bg) || bg.toLowerCase() === config.bg.toLowerCase()) return;
        onSave({ label: config.label, bg: bg.toLowerCase() });
    };

    return (
        <div
            className={`py-2.5 border-b border-[var(--color-border)] last:border-b-0 ${
                config.hidden ? "opacity-60" : ""
            }`}
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setShowPicker((v) => !v)}
                    aria-label={`Change color for ${code}`}
                    className="w-6 h-6 rounded-full flex-shrink-0 ring-1 ring-black/10"
                    style={{ backgroundColor: config.bg }}
                />
                <span className="font-mono text-sm text-[var(--color-text-primary)] w-16 flex-shrink-0">
                    {code}
                </span>
                <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={commitLabel}
                    maxLength={MAX_VISIT_TYPE_LABEL_LENGTH}
                    aria-label={`Description for ${code}`}
                    className="input-google flex-1 min-w-0 text-sm"
                />
                <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${
                        isBuiltIn
                            ? "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                            : "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                    }`}
                >
                    {isBuiltIn ? "Built-in" : "Custom"}
                </span>
                <button
                    type="button"
                    onClick={onToggleHidden}
                    aria-label={config.hidden ? `Unhide ${code}` : `Hide ${code}`}
                    className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] flex-shrink-0"
                >
                    {config.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {isBuiltIn ? (
                    <button
                        type="button"
                        onClick={onRemove}
                        disabled={!hasOverride}
                        aria-label={`Reset ${code} to default`}
                        className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        aria-label={`Delete ${code}`}
                        className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-error,#e53935)] flex-shrink-0"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* The panel only closes via the swatch button — auto-closing on the
                first tap would hide the shade row the user is reaching for. */}
            {showPicker && (
                <div className="mt-2 pl-8">
                    <VisitTypeColorPicker
                        value={config.bg}
                        onChange={commitColor}
                        subject={code}
                    />
                </div>
            )}

            {confirmingDelete && (
                <div className="mt-2 pl-8 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                        Delete {code}? Appointments keep the code and render gray.
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            setConfirmingDelete(false);
                            onRemove();
                        }}
                        className="text-xs px-2 py-1 rounded bg-[var(--color-error,#e53935)] text-white"
                    >
                        Delete
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        className="text-xs px-2 py-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}
