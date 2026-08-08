interface NameablePatient {
    fullName: string;
    nicknames?: string[];
}

/**
 * Display name for an appointment chip.
 *
 * The nickname leads so it survives truncation — chips render the name on a
 * single `truncate` line, and a week column on a phone leaves only ~105px, so
 * whatever sits at the end of the string is the first thing ellipsed.
 */
export function formatPatientDisplayName(patient: NameablePatient): string {
    const nickname = (patient.nicknames ?? []).find((value) => value.trim().length > 0)?.trim();
    if (!nickname) {
        return patient.fullName;
    }
    // Redundant when the nickname is already a word in the full name —
    // `"Jane" Jane Doe` is noise, and matching.ts encourages entering these.
    const tokens = patient.fullName.toLowerCase().split(/\s+/);
    if (tokens.includes(nickname.toLowerCase())) {
        return patient.fullName;
    }
    return `"${nickname}" ${patient.fullName}`;
}
