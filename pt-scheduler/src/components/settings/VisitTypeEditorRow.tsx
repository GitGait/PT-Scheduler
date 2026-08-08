import { useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import type { VisitTypeConfig } from "../../utils/visitTypeColors";
import { isValidVisitTypeColor, MAX_VISIT_TYPE_LABEL_LENGTH } from "../../utils/visitTypeCodes";

/** One-tap swatches for iPhone: the 12 built-in colours plus two neutrals. */
export const VISIT_TYPE_COLOR_PRESETS = [
    "#00897b", "#8e24aa", "#5c6bc0", "#fb8c00",
    "#e53935", "#039be5", "#d81b60", "#ff6d00",
    "#ffab00", "#00bcd4", "#795548", "#607d8b",
    "#546e7a", "#9e9e9e",
];

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
    const [showPresets, setShowPresets] = useState(false);
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
                    onClick={() => setShowPresets((v) => !v)}
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

            {showPresets && (
                <div className="mt-2 pl-8 flex items-center gap-1.5 flex-wrap">
                    {VISIT_TYPE_COLOR_PRESETS.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            aria-label={`Use ${preset} for ${code}`}
                            onClick={() => {
                                commitColor(preset);
                                setShowPresets(false);
                            }}
                            className="w-6 h-6 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: preset }}
                        />
                    ))}
                    <input
                        type="color"
                        value={config.bg}
                        aria-label={`Custom color for ${code}`}
                        onChange={(e) => commitColor(e.target.value)}
                        className="w-8 h-8 p-0 bg-transparent border border-[var(--color-border)] rounded cursor-pointer"
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
