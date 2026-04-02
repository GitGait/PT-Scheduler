# Multiple Phone Numbers Per Patient

## Summary

Replace the single `phone: string` field on Patient with a `phoneNumbers` array, allowing patients to have multiple phone numbers with optional free-text labels (e.g., "Cell", "Home", "Mom's house"). The first entry is the primary number.

## Data Model

### New Zod Schema (`utils/validation.ts`)

```ts
const phoneEntrySchema = z.object({
  number: z.string(),
  label: z.string().optional()  // Free-text: "Cell", "Home", "Mom's house", etc.
});
```

### Patient Type Change (`types/index.ts`)

```diff
- phone: string;
+ phoneNumbers: PhoneEntry[];
```

- `PhoneEntry = z.infer<typeof phoneEntrySchema>` = `{ number: string; label?: string }`
- First entry is the primary number
- Empty array = no phone numbers

### Dexie Migration (`db/schema.ts`)

- Bump DB version
- Upgrade hook iterates all patients:
  - Non-empty `phone` -> `phoneNumbers: [{ number: phone }]`
  - Empty `phone` -> `phoneNumbers: []`
  - Delete old `phone` field

### Google Sheets Sync (`api/sheets.ts`)

- Primary number (`phoneNumbers[0]?.number`) writes to existing `phone` column (no Sheets schema change)
- Additional numbers serialize into a new `Additional Phones` column
- Format: `Label:Number; Label:Number` (e.g., `Cell:555-1234; Mom's house:555-5678`)
- On read/import: parse both columns back into `phoneNumbers` array
- `phone` column is required (maps to first entry); `Additional Phones` is optional (maps to remaining entries)

### OCR / Patient Extraction (`ScanPage`)

- `extractPatientResponseSchema` continues to return `phone: string`
- Mapping layer wraps extracted phone into `phoneNumbers: [{ number: extracted }]`
- No AI prompt changes needed

### Calendar Sync (`api/calendar.ts`)

- Event descriptions pull from `phoneNumbers[0]?.number`

## UI Design

### Contact Card (View Mode — `PatientDetailPage.tsx`)

All numbers listed inline, each as a tappable `tel:` link:

```
Contact
  phone-icon (555) 123-4567
  phone-icon Cell: (555) 987-6543
  phone-icon Mom's house: (555) 111-2222
```

- Label shown as prefix when present
- No special "primary" badge — first is just first
- No numbers -> "No phone number" (same as today)

### Edit Form (`PatientDetailPage.tsx`)

Each phone number is its own row:

```
Phone Numbers
  [ Cell          ] [ (555) 123-4567     ] [x]
  [ Mom's house   ] [ (555) 987-6543     ] [x]
  [+ Add phone number]
```

- Label input: ~30% width, placeholder "Label (optional)"
- Number input: ~60% width, `type="tel"`
- Remove button (x): on the right
- "+" button appends a blank row
- Removing the last number clears the fields instead of removing the row (always at least one row visible)
- No drag-to-reorder — first row entered = primary
- Order is preserved as entered

### Search (`PatientsPage.tsx`)

- Phone search matches across all `phoneNumbers[].number` entries (not just the first)

### Other Phone References

- `SchedulePage.tsx`, `AppointmentDetailModal.tsx`, `AppointmentActionSheet.tsx` — anywhere that currently reads `patient.phone` switches to `patient.phoneNumbers[0]?.number ?? ""`

## Files Touched

| File | Change |
|------|--------|
| `utils/validation.ts` | Add `phoneEntrySchema`, export `PhoneEntry` type |
| `types/index.ts` | `phone: string` -> `phoneNumbers: PhoneEntry[]` on Patient |
| `db/schema.ts` | Version bump + migration hook |
| `db/operations.ts` | Update any phone references |
| `pages/PatientDetailPage.tsx` | Edit form (add/remove rows) + contact card (inline list) |
| `pages/PatientsPage.tsx` | Search across all `phoneNumbers[].number` |
| `pages/SchedulePage.tsx` | `patient.phone` -> `patient.phoneNumbers[0]?.number` |
| `pages/ScanPage.tsx` | Map extracted phone into array at mapping layer |
| `pages/SettingsPage.tsx` | Update if it references phone |
| `api/sheets.ts` | Serialize/deserialize `phoneNumbers`, new column handling |
| `api/calendar.ts` | Pull primary number from array |
| `components/AppointmentDetailModal.tsx` | Primary number reference |
| `components/AppointmentActionSheet.tsx` | Primary number reference |
| `utils/scheduling.ts` | Update if it references phone |
| `hooks/useSync.ts` | Update if it references phone |
| Tests | Update all phone-related test fixtures and assertions |

## Non-Goals

- No drag-to-reorder for phone numbers
- No "primary" badge or explicit primary designation (just position)
- No phone number validation/formatting (same as today)
- No changes to alternateContacts — those remain for other people's numbers
