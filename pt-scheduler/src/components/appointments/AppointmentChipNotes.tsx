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
// Rendered height of one banner row: 10px text at leading-tight (12.5px) +
// py-0.5 (4px) + a 1px top border = 17.5px. Rounded up so the reserve never
// under-pads.
const CHIP_NOTE_ROW_PX = 18;
// Chip height the banner stack may never eat into, so the content column's
// identity rows survive: week view is 4px pad + 16px name + 2px gap + 14px
// time = 36px; day view is 8 + 20 = 28px for the name alone. 40 clears both.
const CHIP_CONTENT_MIN_PX = 40;

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
 * Banner rows the whole stack may use. The stack is bottom-anchored inside an
 * overflow-hidden chip, so anything past this budget would be clipped off the
 * TOP of the stack — i.e. the user's own quick notes. Budget it instead.
 */
function bannerRowBudget(heightPx: number): number {
    return Math.max(0, Math.floor((heightPx - CHIP_CONTENT_MIN_PX) / CHIP_NOTE_ROW_PX));
}

/**
 * The profile-note lines this chip actually renders: meaningful lines, minus any
 * that a quick note already says, capped by the chip's height and by the rows
 * left over once quick notes have taken their share of the budget.
 */
function visibleProfileNoteLines(
    patient: Patient | undefined,
    heightPx: number,
    displayNotes: string[],
    rowsLeft: number
): string[] {
    const allowed = Math.min(allowedProfileNoteLines(heightPx), Math.max(0, rowsLeft));
    if (allowed === 0) return [];

    const quickNotes = new Set(displayNotes.map((note) => note.trim().toLowerCase()));

    // Drop duplicates before capping, so a line the quick notes already cover
    // doesn't burn one of the chip's rows. Dedup runs against the FULL quick-note
    // list (not the visible subset) so a budgeted-out quick note never resurrects
    // its duplicate profile line.
    return meaningfulNoteLines(patient?.notes, Infinity)
        .filter((line) => !quickNotes.has(line.toLowerCase()))
        .slice(0, allowed);
}

/**
 * The whole banner stack for a chip, laid out once so the padding reserve and
 * the rendered banners can never disagree. Quick notes (user-authored) always
 * outrank profile lines for the budget; anything dropped surfaces via the
 * `+N` counter and the tooltip.
 */
function chipNoteStack(
    appointment: Appointment,
    patient: Patient | undefined,
    heightPx: number
): { allQuickNotes: string[]; quickNotes: string[]; profileLines: string[]; reservePx: number } {
    const allQuickNotes = resolveDisplayNotes(appointment, patient);
    const budget = bannerRowBudget(heightPx);
    // Floor of 1: a 15-min chip has no budget, but dropping the only quick note
    // is worse than the overlap. Quick notes are user-authored; profile lines yield.
    const quickNotes =
        allQuickNotes.length > 0
            ? allQuickNotes.slice(0, Math.max(1, Math.min(allQuickNotes.length, budget)))
            : [];
    const profileLines = visibleProfileNoteLines(patient, heightPx, allQuickNotes, budget - quickNotes.length);
    const reservePx = Math.max(0, quickNotes.length + profileLines.length - 1) * CHIP_NOTE_ROW_PX;

    return { allQuickNotes, quickNotes, profileLines, reservePx };
}

/**
 * Extra bottom padding a chip's content column needs for banner rows past the
 * first. The chip's existing padding already reserves one row. Covers the
 * whole stack — quick notes and profile lines alike — not just profile rows.
 */
export function chipNoteStackReservePx(
    appointment: Appointment,
    patient: Patient | undefined,
    heightPx: number
): number {
    return chipNoteStack(appointment, patient, heightPx).reservePx;
}

/**
 * Bottom-anchored note banners on an appointment chip: the color-coded quick
 * notes first, then the patient's profile note (as many lines as the chip fits).
 */
export function AppointmentChipNotes({ appointment, patient, heightPx }: AppointmentChipNotesProps) {
    const { allQuickNotes, quickNotes, profileLines } = chipNoteStack(appointment, patient, heightPx);

    if (quickNotes.length === 0 && profileLines.length === 0) return null;

    const hasApptNotes = (appointment.chipNotes ?? []).length > 0 || Boolean(appointment.chipNote);
    const noteColor = hasApptNotes ? appointment.chipNoteColor : patient?.chipNoteColor;
    const cc = getChipNoteClasses(noteColor);

    const tooltip = [...allQuickNotes, ...meaningfulNoteLines(patient?.notes, Infinity)]
        .filter(Boolean)
        .join("\n");

    // Quick notes the budget had no row for. Surfaced as a +N on the last
    // visible banner rather than dropped silently; the tooltip lists them all.
    const hiddenQuickNotes = allQuickNotes.length - quickNotes.length;

    return (
        <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col"
            style={{ zIndex: 2 }}
            title={tooltip}
        >
            {quickNotes.map((note, idx) => {
                const showCount = hiddenQuickNotes > 0 && idx === quickNotes.length - 1;
                return (
                    <div
                        key={note + idx}
                        className={`${cc.bg} ${cc.text} text-[10px] font-semibold px-1.5 py-0.5 leading-tight border-t ${cc.border} first:border-t-0 flex items-center gap-1`}
                    >
                        <span className="truncate">{note}</span>
                        {showCount && <span className="shrink-0 opacity-80">+{hiddenQuickNotes}</span>}
                    </div>
                );
            })}
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
