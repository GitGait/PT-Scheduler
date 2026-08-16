/**
 * Note text shown on appointment chips comes from fields that machines also
 * write to: Patient.notes carries import stamps, and Appointment.notes is a
 * mirror of the Google Calendar event description. Filter that out before
 * putting a line on a chip.
 */
const BOILERPLATE_NOTE_PATTERNS = [
    // Written by ScanPage / PatientsPage / useSync when creating records
    /^created from scan import$/i,
    /^imported from google calendar event\b/i,
    /^email\s*:/i,
    // Duplicates the visitType column; ScanPage regenerates it on every import
    /^visit\s*type\s*[:-]/i,
    // Google Calendar invite furniture
    /^-::-::-/,
    /join with google meet/i,
    /^join zoom meeting/i,
    /this event has a video call/i,
    /^https?:\/\/\S+$/i,
];

function stripHtml(line: string): string {
    return line
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Hard ceiling on how many profile-note lines a chip will ever banner, no matter
 * how tall the chip is. Shared by the chip renderer and the modal's live preview.
 */
export const MAX_PROFILE_NOTE_LINES = 3;

/**
 * Every line of a note worth showing, in order, with boilerplate and
 * calendar-description junk skipped. Returns [] when nothing survives.
 */
export function meaningfulNoteLines(notes?: string, max = MAX_PROFILE_NOTE_LINES): string[] {
    if (max <= 0) return [];

    const rawLines = (notes ?? "").replace(/<br\s*\/?>/gi, "\n").split("\n");
    const kept: string[] = [];

    for (const raw of rawLines) {
        const line = stripHtml(raw);
        if (!line) continue;
        if (BOILERPLATE_NOTE_PATTERNS.some((pattern) => pattern.test(line))) continue;
        kept.push(line);
        if (kept.length === max) break;
    }

    return kept;
}

/**
 * First line of a note worth showing. Still used where exactly one line is
 * wanted (seeding the quick-note editor).
 */
export function firstMeaningfulNoteLine(notes?: string): string {
    return meaningfulNoteLines(notes, 1)[0] ?? "";
}
