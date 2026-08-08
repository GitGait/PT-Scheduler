import { Plus, Trash2 } from "lucide-react";
import type { AlternateContact } from "../../utils/validation";

interface AlternateContactsEditorProps {
    contacts: AlternateContact[];
    onChange: (contacts: AlternateContact[]) => void;
}

/**
 * Drops incomplete rows and trims; omits `relationship` when blank so the
 * saved shape matches what parseAlternateContactsField produces.
 */
export function cleanAlternateContacts(contacts: AlternateContact[]): AlternateContact[] {
    return contacts
        .filter((c) => c.firstName.trim() && c.phone.trim())
        .map((c) => {
            const relationship = c.relationship?.trim();
            return relationship
                ? { firstName: c.firstName.trim(), phone: c.phone.trim(), relationship }
                : { firstName: c.firstName.trim(), phone: c.phone.trim() };
        });
}

/**
 * Repeatable Name/Phone/Relation rows. Renders the rows and the add button
 * only — the section label stays at the call site, since the forms and the
 * appointment modal style theirs differently.
 */
export function AlternateContactsEditor({ contacts, onChange }: AlternateContactsEditorProps) {
    const updateField = (index: number, field: keyof AlternateContact, value: string) => {
        const updated = [...contacts];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
    };

    return (
        <div className="space-y-3">
            {contacts.map((contact, index) => (
                <div key={index} className="flex gap-2 items-start">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                        <input
                            type="text"
                            value={contact.firstName}
                            onChange={(e) => updateField(index, "firstName", e.target.value)}
                            placeholder="Name"
                            className="input-google text-sm"
                        />
                        <input
                            type="tel"
                            value={contact.phone}
                            onChange={(e) => updateField(index, "phone", e.target.value)}
                            placeholder="Phone"
                            className="input-google text-sm"
                        />
                        <input
                            type="text"
                            value={contact.relationship || ""}
                            onChange={(e) => updateField(index, "relationship", e.target.value)}
                            placeholder="Relation"
                            className="input-google text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange(contacts.filter((_, i) => i !== index))}
                        className="p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors mt-1"
                        aria-label="Remove contact"
                    >
                        <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...contacts, { firstName: "", phone: "" }])}
                className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors py-1"
            >
                <Plus className="w-4 h-4" />
                Add Contact
            </button>
        </div>
    );
}
