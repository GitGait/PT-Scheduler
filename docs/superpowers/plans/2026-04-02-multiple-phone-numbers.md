# Multiple Phone Numbers Per Patient — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `phone: string` field on Patient with a `phoneNumbers: PhoneEntry[]` array supporting multiple numbers with optional free-text labels.

**Architecture:** Add a `phoneEntrySchema` Zod schema, migrate the Patient type, bump Dexie version with an upgrade hook, and mechanically update all ~50 references across 12 files. The edit UIs get dynamic add/remove rows. Sheets sync writes primary to existing `phone` column and extras to a new `additionalPhones` column.

**Tech Stack:** TypeScript, Zod, Dexie.js, React, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-02-multiple-phone-numbers-design.md`

---

### Task 1: Add PhoneEntry Zod Schema and Export Type

**Files:**
- Modify: `pt-scheduler/src/utils/validation.ts:45-57`
- Modify: `pt-scheduler/src/types/index.ts:12-29`

- [ ] **Step 1: Add phoneEntrySchema to validation.ts**

In `pt-scheduler/src/utils/validation.ts`, add the new schema after line 49 (after `alternateContactSchema`), and add the type export after line 137:

```ts
// Add after alternateContactSchema (line 49):
export const phoneEntrySchema = z.object({
  number: z.string(),
  label: z.string().optional(),
});
```

```ts
// Add after the AlternateContact type export (line 137):
export type PhoneEntry = z.infer<typeof phoneEntrySchema>;
```

- [ ] **Step 2: Update Patient interface in types/index.ts**

In `pt-scheduler/src/types/index.ts`, add `PhoneEntry` to the re-exports and replace `phone: string` with `phoneNumbers`:

```ts
// Line 5-16: Add PhoneEntry to the re-export block
export type {
  ExtractedAppointment,
  OCRResponse,
  OptimizeStop,
  OptimizeResponse,
  GeocodeResponse,
  AIMatchResponse,
  AlternateContact,
  PhoneEntry,
  ExtractPatientResponse,
  DistanceMatrixElement,
  DistanceMatrixResponse
} from "../utils/validation";
```

```ts
// Line 28: Replace phone field in Patient interface
// REMOVE: phone: string;
// ADD:
phoneNumbers: import("../utils/validation").PhoneEntry[];
```

- [ ] **Step 3: Run type check to see all breakages**

Run: `cd pt-scheduler && npx tsc --noEmit 2>&1 | head -80`

Expected: Many errors referencing `phone` on Patient. This confirms the type change propagated and shows exactly what needs updating.

- [ ] **Step 4: Commit**

```bash
git add pt-scheduler/src/utils/validation.ts pt-scheduler/src/types/index.ts
git commit -m "feat: add PhoneEntry schema and replace phone with phoneNumbers on Patient"
```

---

### Task 2: Dexie DB Migration

**Files:**
- Modify: `pt-scheduler/src/db/schema.ts:94-115`

- [ ] **Step 1: Add version 6 migration**

In `pt-scheduler/src/db/schema.ts`, add after the version 5 block (after line 114, before the closing `}` of the constructor):

```ts
        // Version 6: Replace phone string with phoneNumbers array
        this.version(6)
            .stores({
                patients: "id, fullName, status",
                appointments: "id, patientId, date, status, syncStatus, visitType",
                recurringBlocks: "id, patientId, dayOfWeek",
                calendarEvents: "id, appointmentId, googleEventId",
                syncQueue: "++id, timestamp, status, nextRetryAt",
                routeCache: "id, date, expiresAt",
                dayNotes: "id, date",
            })
            .upgrade((tx) => {
                return tx
                    .table("patients")
                    .toCollection()
                    .modify((patient) => {
                        const oldPhone = (patient as Record<string, unknown>).phone as string | undefined;
                        patient.phoneNumbers = oldPhone?.trim()
                            ? [{ number: oldPhone.trim() }]
                            : [];
                        delete (patient as Record<string, unknown>).phone;
                    });
            });
```

- [ ] **Step 2: Commit**

```bash
git add pt-scheduler/src/db/schema.ts
git commit -m "feat: add Dexie v6 migration for phone -> phoneNumbers"
```

---

### Task 3: Update DB Operations — Patient Search

**Files:**
- Modify: `pt-scheduler/src/db/operations.ts:101-114`

- [ ] **Step 1: Update patientDB.search to use phoneNumbers**

In `pt-scheduler/src/db/operations.ts`, replace the search filter (lines 106-114):

```ts
    // REPLACE the filter callback (lines 106-114) with:
    async search(query: string): Promise<Patient[]> {
        const lowerQuery = query.toLowerCase();
        const digitQuery = query.replace(/\D/g, "");
        return db.patients
            .filter(
                (p) =>
                    p.fullName.toLowerCase().includes(lowerQuery) ||
                    p.nicknames.some((n) => n.toLowerCase().includes(lowerQuery)) ||
                    (digitQuery.length >= 3 &&
                        (p.phoneNumbers.some((pn) =>
                            pn.number.replace(/\D/g, "").includes(digitQuery)
                        ) ||
                            p.alternateContacts?.some((c) =>
                                c.phone.replace(/\D/g, "").includes(digitQuery)
                            )))
            )
            .toArray();
    },
```

- [ ] **Step 2: Commit**

```bash
git add pt-scheduler/src/db/operations.ts
git commit -m "feat: update patient search to query all phoneNumbers entries"
```

---

### Task 4: Update Google Sheets Sync — Serialize/Deserialize PhoneNumbers

**Files:**
- Modify: `pt-scheduler/src/api/sheets.ts:17,327,384-413,415-427,555-567,614-639,683`

- [ ] **Step 1: Add phoneNumbers serialization/deserialization helpers**

In `pt-scheduler/src/api/sheets.ts`, add these two new exported functions after the existing `serializeAlternateContactsField` function (after line 85):

```ts
const PHONE_ENTRY_SEPARATOR = ";";
const PHONE_LABEL_SEPARATOR = ":";

/** Serialize additional phone numbers (index 1+) to "Label:Number; Label:Number" format */
export function serializeAdditionalPhonesField(
    phoneNumbers: Patient["phoneNumbers"]
): string {
    if (phoneNumbers.length <= 1) return "";
    return phoneNumbers
        .slice(1)
        .map((entry) => {
            const label = entry.label?.trim();
            const number = entry.number.trim();
            if (!number) return "";
            return label ? `${label}${PHONE_LABEL_SEPARATOR}${number}` : number;
        })
        .filter(Boolean)
        .join(`${PHONE_ENTRY_SEPARATOR} `);
}

/** Parse "Label:Number; Number; Label:Number" into PhoneEntry[] (excludes primary) */
export function parseAdditionalPhonesField(
    value: string
): { number: string; label?: string }[] {
    if (!value.trim()) return [];
    return value
        .split(PHONE_ENTRY_SEPARATOR)
        .map((entry) => {
            const trimmed = entry.trim();
            if (!trimmed) return null;
            const colonIndex = trimmed.indexOf(PHONE_LABEL_SEPARATOR);
            if (colonIndex > 0) {
                const label = trimmed.slice(0, colonIndex).trim();
                const number = trimmed.slice(colonIndex + 1).trim();
                if (!number) return null;
                return label ? { number, label } : { number };
            }
            return { number: trimmed };
        })
        .filter((entry): entry is { number: string; label?: string } => entry !== null);
}
```

- [ ] **Step 2: Update DEFAULT_PATIENTS_RANGE and DEFAULT_PATIENT_HEADERS**

Change the range from `A:K` to `A:L` to accommodate the new column, and add the header:

```ts
// Line 17: update range
const DEFAULT_PATIENTS_RANGE = `${PATIENTS_SHEET_TITLE}!A:L`;

// Lines 415-427: add "additionalPhones" to the headers array
const DEFAULT_PATIENT_HEADERS = [
    "id",
    "fullName",
    "nicknames",
    "phone",
    "alternateContacts",
    "address",
    "lat",
    "lng",
    "status",
    "notes",
    "forOtherPtAt",
    "additionalPhones",
];
```

- [ ] **Step 3: Update buildPatientFromSheetRow (line 327)**

Replace the phone line and add additionalPhones parsing:

```ts
// Line 327: replace
// OLD: phone: getValue("phone"),
// NEW:
phoneNumbers: (() => {
    const primary = getValue("phone");
    const additional = parseAdditionalPhonesField(
        getValue("additionalPhones") || getValue("additionalphones")
    );
    const entries: { number: string; label?: string }[] = [];
    if (primary.trim()) entries.push({ number: primary.trim() });
    entries.push(...additional);
    return entries;
})(),
```

- [ ] **Step 4: Update buildPatientRowForHeaders (line 628)**

Replace the phone write and add additionalPhones write:

```ts
// Line 628: replace
// OLD: setCell(["phone", "phonenumber"], patient.phone);
// NEW:
setCell(["phone", "phonenumber"], patient.phoneNumbers[0]?.number ?? "");
setCell(["additionalphones"], serializeAdditionalPhonesField(patient.phoneNumbers));
```

- [ ] **Step 5: Update buildSheetPatientDedupKeys (line 387) and removeDuplicateRowsInSinglePatientSheet (line 566)**

These use `phone: string` in their input type. Update the dedup key builder:

```ts
// Line 384-388: the input type stays the same (it takes raw sheet row strings)
// No change needed — these operate on raw sheet cell values, not Patient objects
```

No change needed here — these functions receive raw string values from sheet rows, not Patient objects.

- [ ] **Step 6: Commit**

```bash
git add pt-scheduler/src/api/sheets.ts
git commit -m "feat: add phoneNumbers serialization for Sheets sync"
```

---

### Task 5: Update PatientDetailPage — View and Edit

**Files:**
- Modify: `pt-scheduler/src/pages/PatientDetailPage.tsx:13-21,41-49,77-84,114-121,151-155,207-232,334-381`

- [ ] **Step 1: Update EditFormData interface and form initialization**

Replace the `EditFormData` interface and update all form data references:

```ts
// Lines 13-21: Replace interface
interface EditFormData {
    fullName: string;
    nicknames: string;
    phoneNumbers: { number: string; label: string }[];
    alternateContacts: string;
    address: string;
    notes: string;
    status: PatientStatus;
}
```

- [ ] **Step 2: Update form initialization (lines 41-49 and 77-84)**

Where `formData` is initialized from a patient, replace `phone: found.phone` with the new field:

```ts
// Replace phone: found.phone (line 44) with:
phoneNumbers: found.phoneNumbers.length > 0
    ? found.phoneNumbers.map((pn) => ({ number: pn.number, label: pn.label ?? "" }))
    : [{ number: "", label: "" }],
```

Apply the same change at line 80 (the other initialization block) using `patient` instead of `found`.

- [ ] **Step 3: Update handleSave (lines 114-121)**

Replace the phone save logic:

```ts
// Replace phone: formData.phone.trim() (line 117) with:
phoneNumbers: formData.phoneNumbers
    .filter((pn) => pn.number.trim())
    .map((pn) => {
        const label = pn.label.trim();
        return label ? { number: pn.number.trim(), label } : { number: pn.number.trim() };
    }),
```

- [ ] **Step 4: Update the edit form UI (lines 207-232)**

Replace the single phone input with dynamic phone number rows:

```tsx
// Replace the phone <div> block (lines 207-218) with:
<div>
    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
        Phone Numbers
    </label>
    <div className="space-y-2">
        {formData.phoneNumbers.map((pn, idx) => (
            <div key={idx} className="flex gap-2 items-center">
                <input
                    type="text"
                    value={pn.label}
                    onChange={(e) => {
                        const updated = [...formData.phoneNumbers];
                        updated[idx] = { ...updated[idx], label: e.target.value };
                        handleInputChange("phoneNumbers", updated);
                    }}
                    className="w-[30%] input-google"
                    placeholder="Label (optional)"
                />
                <input
                    type="tel"
                    value={pn.number}
                    onChange={(e) => {
                        const updated = [...formData.phoneNumbers];
                        updated[idx] = { ...updated[idx], number: e.target.value };
                        handleInputChange("phoneNumbers", updated);
                    }}
                    className="flex-1 input-google"
                    placeholder="555-123-4567"
                />
                <button
                    type="button"
                    onClick={() => {
                        if (formData.phoneNumbers.length <= 1) {
                            handleInputChange("phoneNumbers", [{ number: "", label: "" }]);
                        } else {
                            handleInputChange(
                                "phoneNumbers",
                                formData.phoneNumbers.filter((_, i) => i !== idx)
                            );
                        }
                    }}
                    className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    aria-label="Remove phone number"
                >
                    <X className="w-4 h-4 text-red-500" />
                </button>
            </div>
        ))}
        <button
            type="button"
            onClick={() =>
                handleInputChange("phoneNumbers", [
                    ...formData.phoneNumbers,
                    { number: "", label: "" },
                ])
            }
            className="text-sm text-[var(--color-primary)] hover:underline"
        >
            + Add phone number
        </button>
    </div>
</div>
```

- [ ] **Step 5: Update view mode Contact card (lines 334-347)**

Replace the single phone display with a list:

```tsx
// Replace the phone display block (lines 337-347) with:
{patient.phoneNumbers.length > 0 ? (
    patient.phoneNumbers.map((pn, idx) => (
        <a
            key={idx}
            href={buildPhoneHref(pn.number)!}
            className="flex items-center gap-2 text-[var(--color-primary)] hover:underline"
        >
            <Phone className="w-4 h-4" />
            {pn.label ? `${pn.label}: ${pn.number}` : pn.number}
        </a>
    ))
) : (
    <p className="text-[var(--color-text-secondary)] text-sm">No phone number</p>
)}
```

- [ ] **Step 6: Commit**

```bash
git add pt-scheduler/src/pages/PatientDetailPage.tsx
git commit -m "feat: multi-phone edit/view UI on PatientDetailPage"
```

---

### Task 6: Update PatientsPage — Forms, Display, CSV Import, and Dedup

**Files:**
- Modify: `pt-scheduler/src/pages/PatientsPage.tsx:36-56,288-300,302-307,345-366,403-418,601-612,850-965,1165-1175,1460-1475,1496-1515,1730-1745,1944-1955`

- [ ] **Step 1: Update PatientFormData interface and emptyForm**

```ts
// Lines 36-45: Replace interface
interface PatientFormData {
    fullName: string;
    nicknames: string;
    phoneNumbers: { number: string; label: string }[];
    address: string;
    email: string;
    alternateContacts: string;
    notes: string;
    status: PatientStatus;
}

// Lines 47-56: Replace emptyForm
const emptyForm: PatientFormData = {
    fullName: "",
    nicknames: "",
    phoneNumbers: [{ number: "", label: "" }],
    address: "",
    email: "",
    alternateContacts: "",
    notes: "",
    status: "active",
};
```

- [ ] **Step 2: Update CsvParsedPatient and PatientIdentityLike interfaces**

```ts
// Lines 288-300: Replace CsvParsedPatient
interface CsvParsedPatient {
    id?: string;
    fullName: string;
    nicknames: string[];
    phoneNumbers: { number: string; label?: string }[];
    alternateContacts: Patient["alternateContacts"];
    address: string;
    lat?: number;
    lng?: number;
    email?: string;
    status: PatientStatus;
    notes: string;
}

// Lines 302-307: Replace PatientIdentityLike
interface PatientIdentityLike {
    id?: string;
    fullName: string;
    phoneNumbers: { number: string; label?: string }[];
    address: string;
}
```

- [ ] **Step 3: Update buildPatientDedupKeys (lines 345-366)**

```ts
function buildPatientDedupKeys(patient: PatientIdentityLike): string[] {
    const keys: string[] = [];
    const id = normalizeIdentifier(patient.id);
    const name = normalizePersonName(patient.fullName);
    const phone = normalizePhoneForMatch(patient.phoneNumbers[0]?.number ?? "");
    const address = normalizeAddressForMatch(patient.address);

    if (id) {
        keys.push(`id:${id}`);
    }
    if (name && phone) {
        keys.push(`name_phone:${name}|${phone}`);
    }
    if (name && address) {
        keys.push(`name_address:${name}|${address}`);
    }
    if (name && !phone && !address) {
        keys.push(`name_only:${name}`);
    }

    return keys;
}
```

- [ ] **Step 4: Update parsePatientRowFromCsv (line 410)**

```ts
// Line 410: Replace
// OLD: phone: getMappedValue("phone"),
// NEW:
phoneNumbers: (() => {
    const primary = getMappedValue("phone");
    return primary.trim() ? [{ number: primary.trim() }] : [];
})(),
```

- [ ] **Step 5: Update mergePatientRecords (line 612)**

```ts
// Line 612: Replace
// OLD: phone: mergeStringValue(primary.phone, duplicate.phone),
// NEW:
phoneNumbers: primary.phoneNumbers.length > 0 ? primary.phoneNumbers : duplicate.phoneNumbers,
```

- [ ] **Step 6: Update all patient object constructions in CSV import (lines 860-965)**

Every `buildPatientDedupKeys` call passes `phone:` — update to `phoneNumbers:`:

```ts
// Line 860-865: Replace dedup key building
const keys = buildPatientDedupKeys({
    id: localPatient.id,
    fullName: localPatient.fullName,
    phoneNumbers: localPatient.phoneNumbers,
    address: localPatient.address,
});

// Line 906: Replace in patient object construction
// OLD: phone: parsed.phone,
// NEW:
phoneNumbers: parsed.phoneNumbers,

// Line 928: Same replacement
phoneNumbers: parsed.phoneNumbers,

// Lines 940-944: Replace dedup key building
const keys = buildPatientDedupKeys({
    id: storedPatient.id,
    fullName: storedPatient.fullName,
    phoneNumbers: storedPatient.phoneNumbers,
    address: storedPatient.address,
});

// Lines 957-961: Same replacement
const storedKeys = buildPatientDedupKeys({
    id: storedPatient.id,
    fullName: storedPatient.fullName,
    phoneNumbers: storedPatient.phoneNumbers,
    address: storedPatient.address,
});
```

- [ ] **Step 7: Update AI extraction mapping (lines 1165-1175)**

```ts
// Line 1168: Replace
// OLD: phone: extracted.phone.trim() || inferPhoneFromUnstructuredText(rawText),
// NEW:
phoneNumbers: (() => {
    const p = extracted.phone.trim() || inferPhoneFromUnstructuredText(rawText);
    return p ? [{ number: p }] : [];
})(),
```

- [ ] **Step 8: Update handleExtractFromIntake (lines 1460-1475)**

```ts
// Line 1464: Replace
// OLD: phone: extracted.phone || prev.phone,
// NEW:
phoneNumbers: extracted.phone
    ? [{ number: extracted.phone, label: "" }]
    : prev.phoneNumbers,
```

- [ ] **Step 9: Update handleSubmit (lines 1496-1515)**

```ts
// Line 1508: Replace
// OLD: phone: formData.phone.trim(),
// NEW:
phoneNumbers: formData.phoneNumbers
    .filter((pn) => pn.number.trim())
    .map((pn) => {
        const label = pn.label.trim();
        return label ? { number: pn.number.trim(), label } : { number: pn.number.trim() };
    }),
```

- [ ] **Step 10: Update patient list display (lines 1730-1745)**

```tsx
// Lines 1734-1743: Replace phone display
// OLD: {patient.phone && ( ... patient.phone ... )}
// NEW:
{patient.phoneNumbers[0]?.number && (
    <a
        href={buildPhoneHref(patient.phoneNumbers[0].number) ?? "#"}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-[var(--color-primary)] text-sm hover:underline"
        aria-label={`Call ${patient.fullName}`}
    >
        <Phone className="w-4 h-4" />
        {patient.phoneNumbers[0].number}
    </a>
)}
```

- [ ] **Step 11: Update add patient form (lines 1944-1955)**

Replace the single phone input with dynamic rows (same pattern as PatientDetailPage):

```tsx
// Replace the phone <div> (lines 1944-1955) with:
<div>
    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
        Phone Numbers
    </label>
    <div className="space-y-2">
        {formData.phoneNumbers.map((pn, idx) => (
            <div key={idx} className="flex gap-2 items-center">
                <input
                    type="text"
                    value={pn.label}
                    onChange={(e) => {
                        const updated = [...formData.phoneNumbers];
                        updated[idx] = { ...updated[idx], label: e.target.value };
                        handleInputChange("phoneNumbers", updated);
                    }}
                    className="w-[30%] input-google"
                    placeholder="Label (optional)"
                />
                <input
                    type="tel"
                    value={pn.number}
                    onChange={(e) => {
                        const updated = [...formData.phoneNumbers];
                        updated[idx] = { ...updated[idx], number: e.target.value };
                        handleInputChange("phoneNumbers", updated);
                    }}
                    className="flex-1 input-google"
                    placeholder="555-123-4567"
                />
                <button
                    type="button"
                    onClick={() => {
                        if (formData.phoneNumbers.length <= 1) {
                            handleInputChange("phoneNumbers", [{ number: "", label: "" }]);
                        } else {
                            handleInputChange(
                                "phoneNumbers",
                                formData.phoneNumbers.filter((_, i) => i !== idx)
                            );
                        }
                    }}
                    className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    aria-label="Remove phone number"
                >
                    <X className="w-4 h-4 text-red-500" />
                </button>
            </div>
        ))}
        <button
            type="button"
            onClick={() =>
                handleInputChange("phoneNumbers", [
                    ...formData.phoneNumbers,
                    { number: "", label: "" },
                ])
            }
            className="text-sm text-[var(--color-primary)] hover:underline"
        >
            + Add phone number
        </button>
    </div>
</div>
```

- [ ] **Step 12: Commit**

```bash
git add pt-scheduler/src/pages/PatientsPage.tsx
git commit -m "feat: update PatientsPage for phoneNumbers array"
```

---

### Task 7: Update AppointmentDetailModal

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentDetailModal.tsx:32,59,135-158,279-292`

- [ ] **Step 1: Replace phone state with phoneNumbers state**

```ts
// Line 32: Replace
// OLD: const [phone, setPhone] = useState("");
// NEW:
const [phoneNumbers, setPhoneNumbers] = useState<{ number: string; label: string }[]>([{ number: "", label: "" }]);
```

```ts
// Line 59: Replace initialization
// OLD: setPhone(patient.phone || "");
// NEW:
setPhoneNumbers(
    patient.phoneNumbers.length > 0
        ? patient.phoneNumbers.map((pn) => ({ number: pn.number, label: pn.label ?? "" }))
        : [{ number: "", label: "" }]
);
```

- [ ] **Step 2: Update handleSave change detection and save (lines 135-158)**

```ts
// Line 135: Replace contact filter
const cleanedContacts = altContacts.filter(c => c.firstName.trim() && c.phone.trim());

// Line 139: Replace change detection
// OLD: const patientChanged = phone !== patient!.phone || address !== patient!.address || altContactsChanged;
// NEW:
const cleanedPhones = phoneNumbers
    .filter((pn) => pn.number.trim())
    .map((pn) => {
        const label = pn.label.trim();
        return label ? { number: pn.number.trim(), label } : { number: pn.number.trim() };
    });
const phonesChanged = JSON.stringify(cleanedPhones) !== JSON.stringify(patient!.phoneNumbers ?? []);
const patientChanged = phonesChanged || address !== patient!.address || altContactsChanged;

// Lines 144-158: Replace save
if (patientChanged) {
    await onSavePatient(patient!.id, {
        phoneNumbers: cleanedPhones,
        address,
        alternateContacts: cleanedContacts,
    });

    if (onSyncToSheet) {
        const updatedPatient: Patient = {
            ...patient!,
            phoneNumbers: cleanedPhones,
            address,
            alternateContacts: cleanedContacts,
        };
        await onSyncToSheet(updatedPatient);
    }
}
```

- [ ] **Step 3: Replace phone input UI with dynamic rows (lines 279-292)**

```tsx
// Replace the Phone Number section with:
<div>
    <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2">
        <Phone className="w-4 h-4" />
        Phone Numbers
    </label>
    <div className="space-y-2">
        {phoneNumbers.map((pn, idx) => (
            <div key={idx} className="flex gap-2 items-center">
                <input
                    type="text"
                    value={pn.label}
                    onChange={(e) => {
                        const updated = [...phoneNumbers];
                        updated[idx] = { ...updated[idx], label: e.target.value };
                        setPhoneNumbers(updated);
                    }}
                    placeholder="Label"
                    className="w-[30%] input-google text-sm"
                />
                <input
                    type="tel"
                    value={pn.number}
                    onChange={(e) => {
                        const updated = [...phoneNumbers];
                        updated[idx] = { ...updated[idx], number: e.target.value };
                        setPhoneNumbers(updated);
                    }}
                    placeholder="Phone number"
                    className="flex-1 input-google text-sm"
                />
                <button
                    type="button"
                    onClick={() => {
                        if (phoneNumbers.length <= 1) {
                            setPhoneNumbers([{ number: "", label: "" }]);
                        } else {
                            setPhoneNumbers(phoneNumbers.filter((_, i) => i !== idx));
                        }
                    }}
                    className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    aria-label="Remove phone number"
                >
                    <Trash2 className="w-4 h-4 text-red-500" />
                </button>
            </div>
        ))}
        <button
            type="button"
            onClick={() => setPhoneNumbers([...phoneNumbers, { number: "", label: "" }])}
            className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors py-1"
        >
            <Plus className="w-4 h-4" />
            Add Phone
        </button>
    </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add pt-scheduler/src/components/AppointmentDetailModal.tsx
git commit -m "feat: multi-phone edit UI in AppointmentDetailModal"
```

---

### Task 8: Update AppointmentActionSheet

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx:201,205,253,257,282`

- [ ] **Step 1: Update all patient.phone references to patient.phoneNumbers[0]?.number**

```ts
// Line 201: Replace
// OLD: const hasPhone = !isPersonal && Boolean(patient?.phone);
// NEW:
const primaryPhone = !isPersonal ? patient?.phoneNumbers[0]?.number : undefined;
const hasPhone = Boolean(primaryPhone);

// Line 205: Replace
// OLD: const phoneHref = buildPhoneHref(patient?.phone);
//      const smsHref = buildSmsHref(patient?.phone);
// NEW:
const phoneHref = buildPhoneHref(primaryPhone);
const smsHref = buildSmsHref(primaryPhone);

// Line 253: Replace
// OLD: {formatPhoneDisplay(patient?.phone)}
// NEW:
{formatPhoneDisplay(primaryPhone)}

// Line 257: Replace
// OLD: onClick={() => copyToClipboard(patient?.phone ?? '', 'phone')}
// NEW:
onClick={() => copyToClipboard(primaryPhone ?? '', 'phone')}

// Line 282: Replace
// OLD: {formatPhoneDisplay(patient?.phone)}
// NEW:
{formatPhoneDisplay(primaryPhone)}
```

- [ ] **Step 2: Commit**

```bash
git add pt-scheduler/src/components/AppointmentActionSheet.tsx
git commit -m "refactor: update AppointmentActionSheet for phoneNumbers"
```

---

### Task 9: Update SchedulePage

**Files:**
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx:2926,2971,2976`

- [ ] **Step 1: Update phone references on appointment chips**

```ts
// Line 2926: Replace in title attribute
// OLD: ${patient?.phone ? ` - ${patient.phone}` : ''}
// NEW:
${patient?.phoneNumbers[0]?.number ? ` - ${patient.phoneNumbers[0].number}` : ''}

// Line 2971: Replace phone row condition
// OLD: {showPhoneRow && patient?.phone && (
// NEW:
{showPhoneRow && patient?.phoneNumbers[0]?.number && (

// Line 2976: Replace phone display
// OLD: <span className="truncate">{patient.phone}</span>
// NEW:
<span className="truncate">{patient.phoneNumbers[0].number}</span>
```

- [ ] **Step 2: Commit**

```bash
git add pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: update SchedulePage chip phone display for phoneNumbers"
```

---

### Task 10: Update useSync.ts — Calendar Sync Patient Creation

**Files:**
- Modify: `pt-scheduler/src/hooks/useSync.ts:188-217,410-417,755-792`

- [ ] **Step 1: Update patient creation from calendar import (lines 188-217)**

```ts
// Line 192: Replace in new patient creation
// OLD: phone: patientPhone,
// NEW:
phoneNumbers: patientPhone?.trim() ? [{ number: patientPhone.trim() }] : [],

// Lines 204-215: Replace in patient update logic
// OLD: const nextPhone = existingPatient.phone?.trim() || patientPhone;
// NEW:
const nextPhone = existingPatient.phoneNumbers[0]?.number?.trim() || patientPhone;

// Update the comparison (line 209):
// OLD: nextPhone !== existingPatient.phone ||
// NEW:
nextPhone !== (existingPatient.phoneNumbers[0]?.number ?? "") ||

// Update the write (line 214):
// OLD: phone: nextPhone,
// NEW:
phoneNumbers: nextPhone?.trim()
    ? [{ number: nextPhone.trim() }, ...existingPatient.phoneNumbers.slice(1)]
    : existingPatient.phoneNumbers,
```

- [ ] **Step 2: Update all patient?.phone reads for calendar event creation (lines 416, 761, 791)**

```ts
// Line 416: Replace
// OLD: patientPhone = patient?.phone;
// NEW:
patientPhone = patient?.phoneNumbers[0]?.number;

// Line 761: Same replacement
patientPhone = patient?.phoneNumbers[0]?.number;

// Line 791: Same replacement
patientPhone = patient?.phoneNumbers[0]?.number;
```

- [ ] **Step 3: Commit**

```bash
git add pt-scheduler/src/hooks/useSync.ts
git commit -m "refactor: update useSync for phoneNumbers"
```

---

### Task 11: Update SettingsPage and ScanPage

**Files:**
- Modify: `pt-scheduler/src/pages/SettingsPage.tsx:393,556`
- Modify: `pt-scheduler/src/pages/ScanPage.tsx:522`

- [ ] **Step 1: Update SettingsPage**

```ts
// Line 393: Replace
// OLD: const patientPhone = patient?.phone;
// NEW:
const patientPhone = patient?.phoneNumbers[0]?.number;

// Line 556: Update template string
// OLD: id,fullName,nicknames,phone,alternateContacts,address,lat,lng,status,notes
// NEW:
id,fullName,nicknames,phone,alternateContacts,address,lat,lng,status,notes,additionalPhones
```

- [ ] **Step 2: Update ScanPage**

```ts
// Line 522: Replace
// OLD: phone: "",
// NEW:
phoneNumbers: [],
```

- [ ] **Step 3: Commit**

```bash
git add pt-scheduler/src/pages/SettingsPage.tsx pt-scheduler/src/pages/ScanPage.tsx
git commit -m "refactor: update SettingsPage and ScanPage for phoneNumbers"
```

---

### Task 12: Update Tests

**Files:**
- Modify: `pt-scheduler/src/db/schema.test.ts:37`
- Modify: `pt-scheduler/src/db/operations.test.ts:14,31-32,51,72,96`
- Modify: `pt-scheduler/src/api/sheets.test.ts` (add new tests)

- [ ] **Step 1: Update schema.test.ts patient fixture**

```ts
// Line 37: Replace
// OLD: phone: "555-1234",
// NEW:
phoneNumbers: [{ number: "555-1234" }],
```

- [ ] **Step 2: Update operations.test.ts patient fixtures**

Replace every `phone: "..."` in patient objects with `phoneNumbers: [{ number: "..." }]`:

```ts
// Line 14: phoneNumbers: [{ number: "555-5678" }],
// Line 31: phoneNumbers: [{ number: "555-1111" }],
// Line 51: phoneNumbers: [{ number: "555-2222" }],
// Line 72: phoneNumbers: [{ number: "555-3333" }],
// Line 96: phoneNumbers: [{ number: "555-0001" }],
// Line 105: phoneNumbers: [{ number: "555-0002" }],
```

- [ ] **Step 3: Add phone search test to operations.test.ts**

Add a new test after the existing search test:

```ts
it("should search patients by phone number across all entries", async () => {
    await patientDB.add({
        fullName: "MultiPhone, Test",
        nicknames: [],
        phoneNumbers: [
            { number: "555-1111", label: "Cell" },
            { number: "555-2222", label: "Home" },
        ],
        alternateContacts: [],
        address: "1 Test St",
        status: "active",
        notes: "",
    });

    const byFirst = await patientDB.search("5551111");
    expect(byFirst).toHaveLength(1);

    const bySecond = await patientDB.search("5552222");
    expect(bySecond).toHaveLength(1);
    expect(bySecond[0].fullName).toBe("MultiPhone, Test");
});
```

- [ ] **Step 4: Add sheets additionalPhones serialization tests**

Add to `pt-scheduler/src/api/sheets.test.ts`:

```ts
import {
    parseAlternateContactsField,
    serializeAlternateContactsField,
    serializeAdditionalPhonesField,
    parseAdditionalPhonesField,
} from "./sheets";

describe("sheets additional phones", () => {
    it("serializes additional phone numbers with labels", () => {
        const result = serializeAdditionalPhonesField([
            { number: "555-0000" },
            { number: "555-1111", label: "Cell" },
            { number: "555-2222", label: "Home" },
        ]);
        expect(result).toBe("Cell:555-1111; Home:555-2222");
    });

    it("serializes additional phones without labels", () => {
        const result = serializeAdditionalPhonesField([
            { number: "555-0000" },
            { number: "555-1111" },
        ]);
        expect(result).toBe("555-1111");
    });

    it("returns empty string when only primary exists", () => {
        expect(serializeAdditionalPhonesField([{ number: "555-0000" }])).toBe("");
        expect(serializeAdditionalPhonesField([])).toBe("");
    });

    it("parses additional phones with labels", () => {
        const result = parseAdditionalPhonesField("Cell:555-1111; Home:555-2222");
        expect(result).toEqual([
            { number: "555-1111", label: "Cell" },
            { number: "555-2222", label: "Home" },
        ]);
    });

    it("parses additional phones without labels", () => {
        const result = parseAdditionalPhonesField("555-1111; 555-2222");
        expect(result).toEqual([
            { number: "555-1111" },
            { number: "555-2222" },
        ]);
    });

    it("returns empty array for empty string", () => {
        expect(parseAdditionalPhonesField("")).toEqual([]);
        expect(parseAdditionalPhonesField("  ")).toEqual([]);
    });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd pt-scheduler && npx vitest run 2>&1`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add pt-scheduler/src/db/schema.test.ts pt-scheduler/src/db/operations.test.ts pt-scheduler/src/api/sheets.test.ts
git commit -m "test: update all tests for phoneNumbers migration"
```

---

### Task 13: Build Verification and Final Commit

- [ ] **Step 1: Run type check**

Run: `cd pt-scheduler && npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 2: Run full build**

Run: `cd pt-scheduler && npm run build 2>&1`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run all tests**

Run: `cd pt-scheduler && npx vitest run 2>&1`
Expected: All tests pass.

- [ ] **Step 4: Fix any remaining issues**

If any errors remain, fix them and commit.
