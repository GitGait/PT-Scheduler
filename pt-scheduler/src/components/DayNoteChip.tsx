import { StickyNote } from "lucide-react";
import type { DayNote } from "../types";
import { getDayNoteColor } from "../utils/dayNoteColors";
import type { DragEvent, TouchEvent } from "react";

interface DayNoteChipProps {
    note: DayNote;
    topPx: number;
    heightPx: number;
    isDragging: boolean;
    isDayView: boolean;
    onClick: () => void;
    onDragStart: (e: DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => void;
    onTouchEnd: () => void;
}

export function DayNoteChip({
    note,
    topPx,
    heightPx,
    isDragging,
    isDayView,
    onClick,
    onDragStart,
    onDragEnd,
    onTouchStart,
    onTouchEnd,
}: DayNoteChipProps) {
    const colors = getDayNoteColor(note.color);

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={`pointer-events-auto absolute rounded cursor-pointer transition-opacity select-none overflow-hidden ${
                isDragging ? "opacity-40" : "opacity-95 hover:opacity-100"
            }`}
            style={{
                top: topPx,
                height: heightPx,
                right: isDayView ? "4px" : "3px",
                width: isDayView ? "35%" : "35%",
                backgroundColor: colors.bg,
                borderLeft: `3px solid ${colors.border}`,
                color: colors.text,
                zIndex: isDragging ? 5 : 3,
            }}
            title={note.text}
        >
            <div className="flex items-center gap-1 px-1.5 py-1 h-full">
                <StickyNote size={11} className="shrink-0" style={{ color: colors.border }} />
                <span className="text-[10px] leading-tight truncate font-medium">
                    {note.text}
                </span>
            </div>
        </div>
    );
}
