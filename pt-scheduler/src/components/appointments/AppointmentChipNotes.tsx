import type { Appointment, Patient } from "../../types";
import { getChipNoteClasses } from "../../utils/chipNoteColors";

interface AppointmentChipNotesProps {
    appointment: Appointment;
    patient?: Patient;
    heightPx: number;
}

// Minimum chip height before the profile note gets a banner. Chips floor at
// SLOT_HEIGHT_PX - 2 = 46px (a 15-min visit), which has no room to spare.
const PROFILE_NOTE_MIN_HEIGHT_PX = 60;

// Patient.notes is also written by machines: ScanPage stamps every auto-created
// patient, and PatientsPage appends an "Email:" line on save. Neither is worth
// a banner.
const BOILERPLATE_NOTE_PATTERNS = [
    /^created from scan import$/i,
    /^email\s*:/i,
];

function profileNoteFirstLine(notes?: string): string {
    return (
        (notes ?? "")
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line && !BOILERPLATE_NOTE_PATTERNS.some((p) => p.test(line))) ?? ""
    );
}

/**
 * Bottom-anchored note banners on an appointment chip: the color-coded quick
 * notes first, then the patient's profile note (first meaningful line only).
 */
export function AppointmentChipNotes({ appointment, patient, heightPx }: AppointmentChipNotesProps) {
    const allNotes: string[] = [
        ...(appointment.chipNotes ?? []),
        ...((appointment.chipNote && !(appointment.chipNotes ?? []).includes(appointment.chipNote))
            ? [appointment.chipNote]
            : []),
    ];
    const patientAllNotes: string[] = allNotes.length === 0
        ? [
            ...(patient?.chipNotes ?? []),
            ...((patient?.chipNote && !(patient?.chipNotes ?? []).includes(patient.chipNote))
                ? [patient.chipNote]
                : []),
        ]
        : [];
    const displayNotes = allNotes.length > 0 ? allNotes : patientAllNotes;

    const profileNote = profileNoteFirstLine(patient?.notes);
    const isDuplicate = displayNotes.some(
        (note) => note.trim().toLowerCase() === profileNote.toLowerCase()
    );
    const showProfileNote =
        profileNote !== "" && !isDuplicate && heightPx >= PROFILE_NOTE_MIN_HEIGHT_PX;

    if (displayNotes.length === 0 && !showProfileNote) return null;

    const noteColor = allNotes.length > 0 ? appointment.chipNoteColor : patient?.chipNoteColor;
    const cc = getChipNoteClasses(noteColor);

    const tooltip = [...displayNotes, ...(showProfileNote ? [patient?.notes ?? ""] : [])]
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
            {showProfileNote && (
                <div className="bg-white/90 text-slate-900 text-[10px] font-semibold px-1.5 py-0.5 truncate leading-tight border-t border-white/30 first:border-t-0">
                    {profileNote}
                </div>
            )}
        </div>
    );
}
