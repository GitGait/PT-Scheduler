import { CalendarPlus, StickyNote } from "lucide-react";
import { useEffect, useRef } from "react";

interface SlotActionMenuProps {
    anchorRect: DOMRect;
    onAddAppointment: () => void;
    onAddNote: () => void;
    onClose: () => void;
}

export function SlotActionMenu({ anchorRect, onAddAppointment, onAddNote, onClose }: SlotActionMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Position: center horizontally on anchor, below by default, above if near bottom
    const menuWidth = 180;
    const menuHeight = 96;
    const gap = 4;
    const viewportHeight = window.innerHeight;

    const left = Math.max(8, Math.min(
        anchorRect.left + anchorRect.width / 2 - menuWidth / 2,
        window.innerWidth - menuWidth - 8
    ));
    const fitsBelow = anchorRect.bottom + gap + menuHeight < viewportHeight - 8;
    const top = fitsBelow
        ? anchorRect.bottom + gap
        : anchorRect.top - gap - menuHeight;

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    // Focus first button
    useEffect(() => {
        const firstBtn = menuRef.current?.querySelector("button");
        firstBtn?.focus();
    }, []);

    return (
        <div className="fixed inset-0 z-50" onClick={onClose}>
            <div
                ref={menuRef}
                className="fixed bg-[var(--color-surface)] rounded-xl shadow-lg border border-[var(--color-border)] overflow-hidden"
                style={{ left, top, width: menuWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={() => { onAddAppointment(); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                    <CalendarPlus size={16} className="text-[var(--color-primary)] shrink-0" />
                    Add Appointment
                </button>
                <div className="mx-3 border-t border-[var(--color-border-light)]" />
                <button
                    onClick={() => { onAddNote(); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                    <StickyNote size={16} className="text-amber-500 shrink-0" />
                    Add Note
                </button>
            </div>
        </div>
    );
}
