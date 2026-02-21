import type { DayNoteColor } from "../types";

interface DayNoteColorConfig {
    bg: string;
    border: string;
    text: string;
}

const LIGHT_COLORS: Record<DayNoteColor, DayNoteColorConfig> = {
    yellow: { bg: "#fef9c3", border: "#facc15", text: "#713f12" },
    blue:   { bg: "#dbeafe", border: "#60a5fa", text: "#1e3a5f" },
    green:  { bg: "#dcfce7", border: "#4ade80", text: "#14532d" },
    pink:   { bg: "#fce7f3", border: "#f472b6", text: "#831843" },
    purple: { bg: "#f3e8ff", border: "#c084fc", text: "#581c87" },
    orange: { bg: "#ffedd5", border: "#fb923c", text: "#7c2d12" },
};

const DARK_COLORS: Record<DayNoteColor, DayNoteColorConfig> = {
    yellow: { bg: "#422006", border: "#ca8a04", text: "#fef08a" },
    blue:   { bg: "#172554", border: "#3b82f6", text: "#bfdbfe" },
    green:  { bg: "#052e16", border: "#22c55e", text: "#bbf7d0" },
    pink:   { bg: "#500724", border: "#ec4899", text: "#fbcfe8" },
    purple: { bg: "#3b0764", border: "#a855f7", text: "#e9d5ff" },
    orange: { bg: "#431407", border: "#f97316", text: "#fed7aa" },
};

export function getDayNoteColor(color: DayNoteColor): DayNoteColorConfig {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return isDark ? DARK_COLORS[color] : LIGHT_COLORS[color];
}

export const DAY_NOTE_COLORS: DayNoteColor[] = ["yellow", "blue", "green", "pink", "purple", "orange"];
