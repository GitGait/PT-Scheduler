# SchedulePage Decomposition — Low-Risk Phase

## Context

`SchedulePage.tsx` is 3803 lines with ~60 state variables, ~30 handler functions, and ~1200 lines of JSX. This is the biggest maintenance risk in the project — every change requires reading a massive file, and React re-renders the entire component tree on any state change.

This spec covers the **low-risk phase**: 4 extractions + 1 utility dedup that reduce SchedulePage from ~3800 to ~1750 lines. A follow-up phase for the medium/high-risk extractions (drag, resize, touch) can be planned after reassessing.

## Pre-Step: Utility Deduplication (~80 lines saved)

SchedulePage lines 96-228 contain utility functions that duplicate exports from `src/utils/scheduling.ts`:

| SchedulePage local | scheduling.ts equivalent | Notes |
|---|---|---|
| `parseIsoDate` | `parseLocalDate` | Identical (T12:00:00 noon trick) |
| `todayIso` | `todayIso` | SchedulePage's uses `toLocalIsoDate` (more correct near midnight) — update scheduling.ts |
| `minutesToTimeString` | `minutesToTimeString` | scheduling.ts has bounds check — use it |
| `timeStringToMinutes` | `timeStringToMinutes` | scheduling.ts has NaN guard — use it |
| `formatAxisTime` | `formatAxisTime` | Identical |
| `isValidQuarterHour` | `isValidQuarterHour` | Identical |
| `estimateDriveMinutes` | `estimateDriveMinutes` | Identical |
| `buildPhoneHref` | `buildPhoneHref` | Identical |
| `buildGoogleMapsHref` | `buildGoogleMapsHref` | Identical |
| `buildAppleMapsHref` | `buildAppleMapsHref` | Identical |

**Requires care:**
- `getWeekDates`: SchedulePage starts on **Monday**, scheduling.ts starts on **Sunday**. Keep SchedulePage's version — replace the scheduling.ts export with Monday-start. Nothing else imports `getWeekDates` from scheduling.ts, so this is safe.
- `orderByFarthestFromHome`: Unique to SchedulePage. Move to scheduling.ts.
- `buildGoogleMapsDirectionsFromCoordinatesHref`: Only used by DayMap. Move to scheduling.ts or into DayMapModal.
- `isIOS`: Only used in maps menu. Move to scheduling.ts.

**Action:** Replace local utility functions with imports from `scheduling.ts`. Update `scheduling.ts` where SchedulePage's version is more correct (`todayIso`, `getWeekDates`). Move unique utilities (`orderByFarthestFromHome`, `buildGoogleMapsDirectionsFromCoordinatesHref`, `isIOS`) to `scheduling.ts`.

---

## Extraction 1: `useLocationData` hook (~250 lines)

**New file:** `src/hooks/useLocationData.ts`

### What moves out of SchedulePage

**State (lines 303-320):**
- `homeCoordinates` (line 303)
- `resolvedPatientCoordinates` (line 307)
- `patientGeocodeInFlightRef` (line 310)
- `drivingDistances` (line 316)
- `distanceFetchInFlightRef` (line 319)

**Effects:**
- Load home coordinates from geocode (lines 421-458)
- Geocode patient addresses (lines 617-675)
- Fetch driving distances from Distance Matrix API (lines 678-754)

**Functions:**
- `getPatientCoordinates` (lines 757-766)
- `resolvePatientCoordinatesForRouting` callback (lines 768-798)

**Memos:**
- `legInfoByAppointmentId` (lines 800-865)
- `selectedDayEstimatedDriveMinutes` (lines 867-872)

### Interface

```typescript
interface LocationDataResult {
  homeCoordinates: { lat: number; lng: number } | null;
  resolvedPatientCoordinates: Record<string, { lat: number; lng: number }>;
  getPatientCoordinates: (patientId: string) => { lat: number; lng: number } | null;
  resolvePatientCoordinatesForRouting: (patientId: string) => Promise<{ lat: number; lng: number } | null>;
  legInfoByAppointmentId: Record<string, LegInfo>;
  selectedDayEstimatedDriveMinutes: number;
  drivingDistances: Record<string, { miles: number; minutes: number }>;
}

function useLocationData(
  appointments: Appointment[],
  patientById: Map<string, Patient>,
  appointmentsByDay: Record<string, Appointment[]>,
  selectedDayAppointments: Appointment[],
): LocationDataResult
```

### What stays in SchedulePage
Nothing from this cluster. Fully self-contained.

### Risk: LOW
Pure data flow — no DOM interaction, no touch events, no visual coupling.

### Test after extraction
- Appointment chips still show miles/drive time
- Day map still gets correct coordinates
- Auto-arrange still works (consumes `homeCoordinates` and `resolvePatientCoordinatesForRouting`)

---

## Extraction 2: `AddAppointmentModal` component (~350 lines)

**New file:** `src/components/AddAppointmentModal.tsx`

### What moves out of SchedulePage

**State (lines 241-254):**
- `isAddOpen` stays in SchedulePage (trigger)
- `newPatientId`, `newAppointmentDate`, `newStartTime`, `newDuration`, `newVisitType`, `newIsPersonalEvent`, `newPersonalCategory`, `newPersonalTitle`, `newRepeatInterval`, `newRepeatUntil`, `addError`, `isSaving` — all move into the component as local state

**Functions:**
- `openAddAppointment` (lines 895-910) — stays in SchedulePage (sets `isAddOpen` + prefill props)
- `cancelAddAppointment` (lines 961-964) — moves into component as local close handler
- `handleCreateAppointment` (lines 966-1052) — moves into component

**Effects:**
- Patient selection sync (lines 460-473) — moves into component

**JSX:**
- Add Appointment modal (lines 3349-3598, ~249 lines)
- FAB button (lines 3601-3607) — stays in SchedulePage

### Interface

```typescript
interface AddAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  defaultDate: string;
  defaultTime?: string;
  defaultIsPersonal?: boolean;
  onCreated: () => void;  // triggers sync + any post-create logic
}
```

The component accesses `useAppointmentStore` directly for `create` (follows existing pattern — other modals like AppointmentDetailModal access stores directly).

### What stays in SchedulePage
- `isAddOpen` state
- `openAddAppointment` (simplified to just set `isAddOpen` + prefill state)
- FAB button JSX
- SlotActionMenu `onAddAppointment` callback

### Risk: LOW
Self-contained modal, no DOM coordination, no touch events. Follows existing modal pattern.

### Test after extraction
- Open via FAB, fill form, save appointment
- Open via slot context menu with time prefill
- Create personal event
- Create recurring personal event
- Verify patient selection auto-populates

---

## Extraction 3: `DayMapModal` component (~250 lines)

**New file:** `src/components/DayMapModal.tsx`

### What moves out of SchedulePage

**State (lines 339-346):**
- `isDayMapOpen` stays in SchedulePage (trigger)
- `isDayMapLoading`, `dayMapError`, `dayMapInfoMessage`, `dayMapPoints` — move into component
- `dayMapContainerRef`, `dayMapInstanceRef`, `dayMapLayerRef` — move into component

**Interfaces:**
- `DayMapPoint` (lines 88-94) — moves into component file

**Functions:**
- `handleOpenDayMap` (lines 1857-1945) — moves into component
- `handleCloseDayMap` (lines 1947-1954) — moves into component

**Memos:**
- `dayMapDirectionsHref` (lines 2377-2390) — moves into component

**Effects:**
- Leaflet map render effect (lines 2392-2480) — moves into component
- Leaflet cleanup effect (lines 2482-2488) — moves into component

**Utilities:**
- `buildGoogleMapsDirectionsFromCoordinatesHref` (lines 203-222) — moves into this component (only consumer)

**JSX:**
- Day Map modal (lines 3282-3346, ~64 lines)

### Interface

```typescript
interface DayMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  selectedDayAppointments: Appointment[];
  homeCoordinates: { lat: number; lng: number } | null;
  getPatient: (id: string) => Patient | undefined;
  resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>;
}
```

### What stays in SchedulePage
- `isDayMapOpen` state
- "Map Day" button in header (calls `setIsDayMapOpen(true)`)

### Risk: LOW
Self-contained. Leaflet is already dynamically imported. Only risk is the async `import("leaflet")` path, which is already working.

### Test after extraction
- Open day map, see markers for all appointments
- Click "Open in Google Maps" directions link
- Close and reopen on different day
- Open on day with no appointments (should show info message)

---

## Extraction 4: `useWeekActions` hook (~250 lines)

**New file:** `src/hooks/useWeekActions.ts`

### What moves out of SchedulePage

**Interfaces (lines 68-86):**
- `ClearedWeekAppointmentSnapshot`
- `ClearedWeekSnapshot`

**State (lines 253-257, 335-338):**
- `autoArrangeInProgressByDay`, `autoArrangeError`
- `lastClearedWeekSnapshot`, `weekActionInProgress`, `weekActionMessage`, `weekActionError`

**Functions:**
- `handleAutoArrangeDay` (lines 1618-1710)
- `handleClearWeek` (lines 1712-1798)
- `handleUndoClearWeek` (lines 1800-1855)

### Interface

```typescript
interface WeekActionsResult {
  lastClearedWeekSnapshot: ClearedWeekSnapshot | null;
  weekActionInProgress: boolean;
  weekActionMessage: string | null;
  weekActionError: string | null;
  autoArrangeInProgressByDay: Record<string, boolean>;
  autoArrangeError: string | null;
  handleClearWeek: () => Promise<void>;
  handleUndoClearWeek: () => Promise<void>;
  handleAutoArrangeDay: (date: string) => Promise<void>;
}

function useWeekActions(
  weekDates: string[],
  appointmentsByDay: Record<string, Appointment[]>,
  homeCoordinates: { lat: number; lng: number } | null,
  resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>,
  // Cleanup callbacks for clear-week (resets drag/resize/detail state)
  resetInteractionState: () => void,
): WeekActionsResult
```

The hook accesses `useAppointmentStore` directly for `create`, `update`, `delete` (same pattern as other hooks in this codebase).

### What stays in SchedulePage
- Header JSX that renders Clear Week / Undo / Optimize buttons (they call these returned handlers)
- `resetInteractionState` callback that clears `moveAppointmentId`, `draggingAppointmentId`, `resizingAppointmentId`, `detailAppointmentId`, `draftRenderById`

### Risk: LOW
Business logic only — no DOM interaction, no touch events.

### Test after extraction
- Optimize day: appointments reorder by distance from home
- Clear week: all appointments removed, undo button appears
- Undo clear week: appointments restored
- Error handling: network failure during optimize shows error message

---

## Extraction Order & Verification

| Step | What | Lines Saved | Cumulative | Remaining |
|------|------|------------|------------|-----------|
| 0 | Utility dedup | ~80 | ~80 | ~3720 |
| 1 | `useLocationData` | ~250 | ~330 | ~3470 |
| 2 | `AddAppointmentModal` | ~350 | ~680 | ~3120 |
| 3 | `DayMapModal` | ~250 | ~930 | ~2870 |
| 4 | `useWeekActions` | ~250 | ~1180 | ~2620 |

**Note:** Line counts are estimates. Also, some import lines and whitespace get cleaned up during extraction, which may yield slightly more or fewer lines than estimated. Realistic target: **~2500-2700 lines** after this phase.

**After each step:**
1. `npm run build` — TypeScript catches wiring mistakes
2. Quick manual test of the affected feature
3. Commit before starting the next extraction

## Files Modified/Created

**Modified:**
- `src/pages/SchedulePage.tsx` — remove extracted code, add imports
- `src/utils/scheduling.ts` — receive deduplicated utilities

**Created:**
- `src/hooks/useLocationData.ts`
- `src/components/AddAppointmentModal.tsx`
- `src/components/DayMapModal.tsx`
- `src/hooks/useWeekActions.ts`

## Future Phase (not in scope)

After living with the result, consider extracting:
- `useDayNoteDrag` hook (MEDIUM risk, ~120 lines)
- `useAppointmentResize` hook (MEDIUM risk, ~200 lines)
- `useAppointmentDragDrop` hook (HIGH risk, ~550 lines)

These would bring SchedulePage to ~1100-1200 lines but involve complex touch/mouse event coordination.
