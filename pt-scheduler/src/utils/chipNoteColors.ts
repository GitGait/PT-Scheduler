export type ChipNoteColor = "yellow" | "red" | "blue" | "green" | "purple" | "orange";

export const CHIP_NOTE_COLORS: ChipNoteColor[] = ["yellow", "red", "blue", "green", "purple", "orange"];

export const CHIP_NOTE_COLOR_CLASSES: Record<ChipNoteColor, { bg: string; text: string; border: string }> = {
    yellow: { bg: "bg-yellow-400", text: "text-yellow-950", border: "border-yellow-500/30" },
    red:    { bg: "bg-red-400",    text: "text-red-950",    border: "border-red-500/30" },
    blue:   { bg: "bg-blue-400",   text: "text-blue-950",   border: "border-blue-500/30" },
    green:  { bg: "bg-green-400",  text: "text-green-950",  border: "border-green-500/30" },
    purple: { bg: "bg-purple-400", text: "text-purple-950", border: "border-purple-500/30" },
    orange: { bg: "bg-orange-400", text: "text-orange-950", border: "border-orange-500/30" },
};

export const CHIP_NOTE_SWATCH_HEX: Record<ChipNoteColor, string> = {
    yellow: "#facc15",
    red:    "#f87171",
    blue:   "#60a5fa",
    green:  "#4ade80",
    purple: "#c084fc",
    orange: "#fb923c",
};

export function getChipNoteClasses(color?: string): { bg: string; text: string; border: string } {
    const key = color as ChipNoteColor;
    return CHIP_NOTE_COLOR_CLASSES[key] ?? CHIP_NOTE_COLOR_CLASSES.yellow;
}
