import type { Appointment, Patient } from "../../types";
import { getChipNoteClasses } from "../../utils/chipNoteColors";
import { MAX_PROFILE_NOTE_LINES, meaningfulNoteLines } from "../../utils/chipNoteText";

interface AppointmentChipNotesProps {
    appointment: Appointment;
    patient?: Patient;
    heightPx: number;
}

// Minimum chip height before the profile note gets a banner. Chips floor at
// SLOT_HEIGHT_PX - 2 = 46px (a 15-min visit), which has no room to spare.
const PROFILE_NOTE_MIN_HEIGHT_PX = 60;
// Every profile-note line past the first needs this much more chip before it
// earns a row, so a 30-min visit shows two lines and a 45-min visit three.
const PROFILE_NOTE_EXTRA_LINE_PX = 30;
// Rendered height of one banner row: 10px text at leading-tight, py-0.5, 1px border.
const PROFILE_NOTE_ROW_PX = 17;

/** Quick notes from the appointment, falling back to the patient's own. */
function resolveDisplayNotes(appointment: Appointment, patient?: Patient): string[] {
    const apptNotes: string[] = [
        ...(appointment.chipNotes ?? []),
        ...((appointment.chipNote && !(appointment.chipNotes ?? []).includes(appointment.chipNote))
            ? [appointment.chipNote]
            : []),
    ];
    if (apptNotes.length > 0) return apptNotes;

    return [
        ...(patient?.chipNotes ?? []),
        ...((patient?.chipNote && !(patient?.chipNotes ?? []).includes(patient.chipNote))
            ? [patient.chipNote]
            : []),
    ];
}

/** How many profile-note rows this chip is tall enough to carry. */
function allowedProfileNoteLines(heightPx: number): number {
    if (heightPx < PROFILE_NOTE_MIN_HEIGHT_PX) return 0;
    const extra = Math.floor((heightPx - PROFILE_NOTE_MIN_HEIGHT_PX) / PROFILE_NOTE_EXTRA_LINE_PX);
    return Math.min(MAX_PROFILE_NOTE_LINES, 1 + extra);
}

/**
 * The profile-note lines this chip actually renders: meaningful lines, minus any
 * that a quick note already says, capped by the chip's height.
 */
function visibleProfileNoteLines(
    patient: Patient | undefined,
    heightPx: number,
    displayNotes: string[]
): string[] {
    const allowed = allowedProfileNoteLines(heightPx);
    if (allowed === 0) return [];

    const quickNotes = new Set(displayNotes.map((note) => note.trim().toLowerCase()));

    return meaningfulNoteLines(patient?.notes, MAX_PROFILE_NOTE_LINES)
        .filter((line) => !quickNotes.has(line.toLowerCase()))
        .slice(0, allowed);
}

/**
 * Extra bottom padding a chip's content column needs for profile-note rows past
 * the first. The chip's existing padding already reserves one row.
 */
export function chipProfileNoteExtraReservePx(
    appointment: Appointment,
    patient: Patient | undefined,
    heightPx: number
): number {
    const displayNotes = resolveDisplayNotes(appointment, patient);
    const lineCount = visibleProfileNoteLines(patient, heightPx, displayNotes).length;
    return Math.max(0, lineCount - 1) * PROFILE_NOTE_ROW_PX;
}

/**
 * Bottom-anchored note banners on an appointment chip: the color-coded quick
 * notes first, then the patient's profile note (as many lines as the chip fits).
 */
export function AppointmentChipNotes({ appointment, patient, heightPx }: AppointmentChipNotesProps) {
    const displayNotes = resolveDisplayNotes(appointment, patient);
    const profileLines = visibleProfileNoteLines(patient, heightPx, displayNotes);

    if (displayNotes.length === 0 && profileLines.length === 0) return null;

    const hasApptNotes = (appointment.chipNotes ?? []).length > 0 || Boolean(appointment.chipNote);
    const noteColor = hasApptNotes ? appointment.chipNoteColor : patient?.chipNoteColor;
    const cc = getChipNoteClasses(noteColor);

    const tooltip = [...displayNotes, ...(profileLines.length > 0 ? [patient?.notes ?? ""] : [])]
        .filter(Boolean)
        .join("\n");

    return (
        <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col"
            style={{ zIndex: 2 }}
            title={tooltip}
        >
            {displayNotes.map((note, idx) => (
                <div
                    key={note + idx}
                    className={`${cc.bg} ${cc.text} text-[10px] font-semibold px-1.5 py-0.5 truncate leading-tight border-t ${cc.border} first:border-t-0`}
                >
                    {note}
                </div>
            ))}
            {profileLines.map((line, idx) => (
                <div
                    key={line + idx}
                    className="bg-white/90 text-slate-900 text-[10px] font-semibold px-1.5 py-0.5 truncate leading-tight border-t border-white/30 first:border-t-0"
                >
                    {line}
                </div>
            ))}
        </div>
    );
}
