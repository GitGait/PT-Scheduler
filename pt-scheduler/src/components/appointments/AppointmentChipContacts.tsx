import { Phone } from "lucide-react";
import type { Patient } from "../../types";
import type { PhoneEntry } from "../../utils/validation";

/** Chip height at which non-primary phones and alternate contacts appear. */
const EXTRA_CONTACT_MIN_HEIGHT_PX = 88;
/** Chip height at which the primary phone appears. */
const PRIMARY_PHONE_MIN_HEIGHT_PX = 58;

interface ChipContactRowsProps {
    patient: Patient;
    heightPx: number;
    isDayView: boolean;
}

/** "Label: number" when the entry is labelled, otherwise the bare number. */
export function formatPhoneEntry(entry: PhoneEntry): string {
    return entry.label ? `${entry.label}: ${entry.number}` : entry.number;
}

/**
 * Every phone number for the chip's hover tooltip, so numbers hidden by a short
 * chip are still reachable. Empty string when there is nothing to show.
 */
export function chipPhoneTooltip(patient?: Patient): string {
    return (patient?.phoneNumbers ?? [])
        .filter((entry) => entry.number)
        .map(formatPhoneEntry)
        .join(' / ');
}

function ChipContactRow({ text, isDayView, dim }: { text: string; isDayView: boolean; dim?: boolean }) {
    return (
        <div
            className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis ${
                dim ? 'opacity-85' : 'opacity-90'
            } ${isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'}`}
        >
            <Phone className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
            <span className="truncate">{text}</span>
        </div>
    );
}

/**
 * Every phone number on the patient, primary first. The primary shows on any
 * chip tall enough for a phone row; the rest need the same height as the
 * alternate contacts below them.
 */
export function ChipPhoneRows({ patient, heightPx, isDayView }: ChipContactRowsProps) {
    if (heightPx < PRIMARY_PHONE_MIN_HEIGHT_PX) return null;

    const entries = heightPx >= EXTRA_CONTACT_MIN_HEIGHT_PX
        ? patient.phoneNumbers
        : patient.phoneNumbers.slice(0, 1);
    const visible = entries.filter((entry) => entry.number);
    if (visible.length === 0) return null;

    return (
        <>
            {visible.map((entry, idx) => (
                <ChipContactRow key={entry.number || idx} text={formatPhoneEntry(entry)} isDayView={isDayView} />
            ))}
        </>
    );
}

/** Alternate contacts, one row each. */
export function ChipAlternateContactRows({ patient, heightPx, isDayView }: ChipContactRowsProps) {
    if (heightPx < EXTRA_CONTACT_MIN_HEIGHT_PX) return null;

    const contacts = patient.alternateContacts ?? [];
    if (contacts.length === 0) return null;

    return (
        <>
            {contacts.map((contact, idx) => (
                <ChipContactRow
                    key={contact.phone || idx}
                    text={contact.firstName ? `${contact.firstName}: ${contact.phone}` : contact.phone}
                    isDayView={isDayView}
                    dim
                />
            ))}
        </>
    );
}
