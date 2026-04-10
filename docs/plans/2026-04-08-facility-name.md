# Plan: Add Facility Name to Patient Extraction & Display

## Context
When patients live in assisted living facilities, the AI extraction from referral text should capture the facility name (e.g., "Sunrise Senior Living") and display it near the address. Currently there is no `facilityName` field — the address is a plain geocoding-ready string.

**Approach:** Add a dedicated `facilityName?: string` field to the Patient type. This keeps the address clean for geocoding/navigation while giving the facility name its own display space. Embedding it in the address string would break geocoding and Google Maps links.

---

## Changes (8 files)

### 1. Patient type — `pt-scheduler/src/types/index.ts:32`
Add `facilityName?: string` after `address`:
```typescript
address: string;
facilityName?: string;  // NEW
lat?: number;
```

### 2. DB schema — `pt-scheduler/src/db/schema.ts:138`
Add version 7 (no upgrade needed — optional field, no new index):
```typescript
this.version(7).stores({
    patients: "id, fullName, status",
    appointments: "id, patientId, date, status, syncStatus, visitType",
    recurringBlocks: "id, patientId, dayOfWeek",
    calendarEvents: "id, appointmentId, googleEventId",
    syncQueue: "++id, timestamp, status, nextRetryAt",
    routeCache: "id, date, expiresAt",
    dayNotes: "id, date",
});
```

### 3. Validation schema — `pt-scheduler/src/utils/validation.ts:56-63`
Add `facilityName` to `extractPatientResponseSchema`:
```typescript
facilityName: z.string().default(""),
```
Add `facilityName` to `csvColumnMappingSchema` (~line 66):
```typescript
facilityName: z.string().nullable(),
```

### 4. AI extraction prompt — `pt-scheduler/api/_prompts.ts:108-130`
Update `buildExtractPatientPrompt()`:
- Add rule: "If the patient lives in an assisted living facility, nursing home, or group home, extract the facility name into `facilityName`. Otherwise use empty string."
- Add rule: "Do NOT include the facility name in the address field."
- Add `"facilityName": ""` to the JSON response format example

Update `buildCsvMappingPrompt()` (~line 158):
- Add `"facilityName": string | null` to the target mapping shape

### 5. PatientsPage — `pt-scheduler/src/pages/PatientsPage.tsx`

**Form & extraction:**

| Location | Change |
|----------|--------|
| `PatientFormData` (line 36-45) | Add `facilityName: string` |
| `emptyForm` (line 47-56) | Add `facilityName: ""` |
| `handleExtractFromIntake` (line 1467-1482) | Add `facilityName: extracted.facilityName \|\| prev.facilityName` |
| `handleSubmit` (line 1510-1528) | Add `facilityName: formData.facilityName.trim() \|\| undefined` |
| Form UI (after line 2019) | Add "Facility Name" input field above Address field |

**CSV import pipeline:**

| Location | Change |
|----------|--------|
| `CSV_TARGET_FIELDS` (line 193-205) | Add `{ key: "facilityName", label: "Facility Name" }` after address |
| `EMPTY_CSV_MAPPING` (line 216-228) | Add `facilityName: null` |
| `toCsvMappingState` (line 230-243) | Add `facilityName: mapping?.facilityName ?? null` |
| `guessCsvMapping` aliases (line 247-259) | Add `facilityName: ["facilityname", "facility", "facility_name", "assistedliving"]` |
| `CsvParsedPatient` interface (line 288-300) | Add `facilityName?: string` |
| `parsePatientRowFromCsv` (line 403-421) | Add `facilityName: getMappedValue("facilityName") \|\| undefined` |
| `persistParsedPatients` upsert path (line 905-919) | Add `facilityName: parsed.facilityName` to the manually-constructed Patient object |
| `persistParsedPatients` add path (line 928-939) | Add `facilityName: parsed.facilityName` to the `add()` call |
| Unstructured CSV import (line 1168-1180) | Add `facilityName: extracted.facilityName \|\| undefined` to `parsedRows.push()` |

**Display:**

| Location | Change |
|----------|--------|
| Patient list subtitle (line 1743) | Show `facilityName — address` when facility exists |

### 6. PatientDetailPage — `pt-scheduler/src/pages/PatientDetailPage.tsx`

| Location | Change |
|----------|--------|
| `EditFormData` (line 13-21) | Add `facilityName: string` |
| `handleStartEdit` (line 78-89) | Add `facilityName: patient.facilityName \|\| ""` |
| `handleSaveEdit` changes object (line 115-131) | Add `facilityName: formData.facilityName.trim() \|\| undefined` |
| Edit form UI (after line 305) | Add "Facility Name" input above Address |
| Address Card display (line 449-473) | Show facility name above address link; change condition to `patient.address \|\| patient.facilityName` |

### 7. Sheets sync — `pt-scheduler/src/api/sheets.ts`

| Location | Change |
|----------|--------|
| `DEFAULT_PATIENT_HEADERS` (line 466-479) | Add `"facilityName"` after `"address"` |
| `DEFAULT_PATIENTS_RANGE` (line 17) | Change `A:L` to `A:M` (13 columns) |
| `fetchPatientSheetRows` fallback range (line 736) | Change `A:L` to `A:M` |
| `parsePatientRow` (line 340-392) | Add `facilityName: getValue("facilityName") \|\| undefined` |
| `buildPatientRowForHeaders` (line 666-692) | Add `setCell(["facilityname", "facility"], patient.facilityName \|\| "")` |

### 8. CSV template — `pt-scheduler/public/templates/patients_template.csv`
Add `facilityName` column to header and example row (if this file exists).

---

## Implementation Order
1. Types + DB schema (files 1, 2)
2. Validation + AI prompt (files 3, 4)
3. Sheets sync (file 7)
4. PatientsPage form + display (file 5)
5. PatientDetailPage form + display (file 6)
6. CSV template (file 8)
7. `npm run build` to verify

## Verification
1. **Build check:** `npm run build` passes with no type errors
2. **Manual test — extraction:** Paste a referral containing a facility name (e.g., "Patient resides at Sunrise Senior Living, 456 Oak Ave, Boise, ID 83702") → AI should populate facilityName field separately from address
3. **Manual test — display:** Created patient shows facility name above address on detail page, and in patient list subtitle
4. **Manual test — edit:** Edit patient → facility name field appears, saves correctly
5. **Sheets sync:** New patients sync with facilityName column to Google Sheets
