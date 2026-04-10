# Plan: Chip Note Color Selection

## Context
Quick notes on appointment chips are always yellow (`bg-yellow-400`). The user wants to choose the color of chip note banners from a preset palette. A single color applies to all notes on one chip (not per-note colors).

## Color Palette
Yellow (default), Red, Blue, Green, Purple, Orange — 6 colors matching Tailwind's 400 shade.

## Files to Modify (7 total)

### 1. NEW: `src/utils/chipNoteColors.ts`
Shared color definitions used by both SchedulePage and AppointmentActionSheet. Follows the existing `dayNoteColors.ts` pattern.

Exports:
- `ChipNoteColor` type: `"yellow" | "red" | "blue" | "green" | "purple" | "orange"`
- `CHIP_NOTE_COLORS`: array of color names (for iteration in picker)
- `CHIP_NOTE_COLOR_CLASSES`: record mapping each color to `{ bg, text, border }` Tailwind classes
- `CHIP_NOTE_SWATCH_COLORS`: record mapping each color to hex value for picker dots
- `getChipNoteClasses(color?: string)`: returns class set, defaults to yellow

### 2. `src/types/index.ts`
Add `chipNoteColor?: string` to both `Patient` (after line 42, `chipNotes`) and `Appointment` (after line 71, `chipNotes`).

### 3. `src/components/AppointmentActionSheet.tsx`
- Update `onChipNote` and `onPatientChipNote` callback prop signatures: `(notes: string[], color?: string) => void`
- Add `selectedColor` state initialized from effective color (appointment-level > patient-level > yellow)
- Add color picker row: horizontal row of 6 colored swatch circles between the note input and the Save button
- Pass `selectedColor` through `saveNotes()` to the appropriate callback
- Reset `selectedColor` when appointment changes

### 4. `src/pages/SchedulePage.tsx`
- Import `getChipNoteClasses` from `../utils/chipNoteColors`
- **Chip banner rendering** (~line 3031): Replace hardcoded `bg-yellow-400 text-yellow-950 border-yellow-500/30` with dynamic classes from `getChipNoteClasses()`. Resolve color from appointment-level first, then patient-level fallback (mirroring note text resolution)
- **Action sheet callbacks** (~lines 3698-3713): Update `onChipNote` and `onPatientChipNote` to accept and save `chipNoteColor`

### 5. `src/api/calendar.ts`
- Add `chipNoteColor: "ptSchedulerChipNoteColor"` to `CALENDAR_METADATA_KEYS` (~line 62)
- Write `chipNoteColor` to private metadata in `buildCalendarEvent` (~line 346)

### 6. `src/hooks/useSync.ts`
- Add `chipNoteColor: "ptSchedulerChipNoteColor"` to local `CALENDAR_METADATA_KEYS` (~line 52)
- Parse `chipNoteColor` from calendar metadata after chipNotes parsing (~line 267)
- Include in `appointmentRecord` when present

### 7. `src/db/patientSheetSync.ts`
- Preserve `chipNoteColor` during sheet reconciliation (~line 37, after chipNotes preservation):
  ```typescript
  if (existing.chipNoteColor && !patientToSave.chipNoteColor) {
      patientToSave.chipNoteColor = existing.chipNoteColor;
  }
  ```

## No Dexie Schema Migration Needed
`chipNoteColor` is optional and non-indexed — no version bump required.

## Edge Cases
- **Legacy data**: Missing `chipNoteColor` defaults to yellow via `getChipNoteClasses()`
- **Apply to all**: Color saves to Patient when checked, clears Appointment's color. When unchecked, saves to Appointment only.
- **ScanPage NOMNC**: Adds notes without color — defaults to yellow, correct behavior
- **Tailwind JIT**: Full class names in `chipNoteColors.ts` (within `src/**/*.ts` scan path), no interpolation
- **Calendar sync keys**: Must add to BOTH `calendar.ts` and `useSync.ts` (existing duplication pattern)

## Verification
1. `cd pt-scheduler && npm run build` — no errors
2. Add a quick note, pick a non-yellow color, save — banner renders in chosen color
3. Use "Apply to all" with a color — all future appointments for that patient show the color
4. Remove all notes — color persists silently, reappears when notes re-added
5. Default (no color picked) — yellow, matching current behavior
