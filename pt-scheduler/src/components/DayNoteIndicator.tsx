import { StickyNote } from "lucide-react";
import type { DayNote } from "../types";

interface DayNoteIndicatorProps {
    notes: DayNote[];
    onClick: () => void;
}

export function DayNoteIndicator({ notes, onClick }: DayNoteIndicatorProps) {
    const count = notes.length;

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className="relative mt-0.5 p-0.5 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
            title={count > 0 ? `${count} note${count > 1 ? "s" : ""}` : "Add note"}
        >
            <StickyNote
                size={14}
                className={count > 0
                    ? "text-amber-500"
                    : "text-[var(--color-text-tertiary)] opacity-40 hover:opacity-70"
                }
            />
            {count > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[8px] font-bold leading-none px-0.5">
                    {count}
                </span>
            )}
        </button>
    );
}
