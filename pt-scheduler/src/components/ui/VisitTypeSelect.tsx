import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { VisitType } from "../../types";
import { VISIT_TYPE_CONFIGS } from "../../utils/visitTypeColors";

interface VisitTypeSelectProps {
    value: VisitType;
    onChange: (value: VisitType) => void;
}

export function VisitTypeSelect({ value, onChange }: VisitTypeSelectProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selected = VISIT_TYPE_CONFIGS.find((c) => c.code === value) ?? VISIT_TYPE_CONFIGS[VISIT_TYPE_CONFIGS.length - 1];

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full input-google flex items-center gap-2 text-left"
            >
                <span
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: selected.bg }}
                />
                <span className="flex-1 truncate text-[var(--color-text-primary)]">
                    {selected.code ? `${selected.code} — ${selected.label}` : "None"}
                </span>
                <ChevronDown className={`w-4 h-4 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {VISIT_TYPE_CONFIGS.map((config) => {
                        const isSelected = config.code === value;
                        return (
                            <button
                                key={config.code ?? "none"}
                                type="button"
                                onClick={() => {
                                    onChange(config.code);
                                    setOpen(false);
                                }}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors
                                    ${isSelected ? "bg-[var(--color-primary-light)] font-medium" : "hover:bg-[var(--color-surface-hover)]"}`}
                            >
                                <span
                                    className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-black/10"
                                    style={{ backgroundColor: config.bg }}
                                />
                                <span className="text-[var(--color-text-primary)]">
                                    {config.code ? `${config.code} — ${config.label}` : "None"}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
