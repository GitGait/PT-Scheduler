# SchedulePage Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce SchedulePage.tsx from ~3800 to ~2600 lines by extracting 4 self-contained pieces and deduplicating utilities.

**Architecture:** Extract location/geocoding logic into `useLocationData` hook, Add Appointment form into its own modal component, Day Map into its own modal component, and week actions (clear/undo/optimize) into `useWeekActions` hook. Each extraction removes code from SchedulePage and replaces it with an import + function call.

**Tech Stack:** React 19, TypeScript (strict), Zustand stores, Leaflet (dynamic import), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-09-schedulepage-decomposition-design.md`

**Important:** Line numbers in this plan reference the ORIGINAL SchedulePage.tsx (3803 lines). After each task, line numbers shift. Use function/variable names as the primary anchor, not line numbers.

---

### Task 0: Deduplicate utility functions (~80 lines)

**Files:**
- Modify: `pt-scheduler/src/utils/scheduling.ts`
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx`

SchedulePage lines 96-228 duplicate functions that already exist in `scheduling.ts`. Replace locals with imports.

- [ ] **Step 1: Update `scheduling.ts` — fix `todayIso` and `getWeekDates`**

In `scheduling.ts`, replace the `todayIso` function (line 218) to use `toLocalIsoDate` instead of `toIsoDate` (avoids UTC date shift near midnight):

```typescript
export function todayIso(): string {
    return toLocalIsoDate(new Date());
}
```

Replace `getWeekDates` (line 244) with SchedulePage's Monday-start version:

```typescript
export function getWeekDates(selectedDate: string): string[] {
    const start = parseLocalDate(selectedDate);
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return toLocalIsoDate(day);
    });
}
```

- [ ] **Step 2: Add unique utilities to `scheduling.ts`**

Add these at the bottom of `scheduling.ts` (they exist only in SchedulePage and need to be shared):

```typescript
export function orderByFarthestFromHome<T extends { lat: number; lng: number }>(
    items: T[],
    home: { lat: number; lng: number }
): T[] {
    return [...items].sort(
        (a, b) =>
            calculateMilesBetweenCoordinates(home, b) - calculateMilesBetweenCoordinates(home, a)
    );
}

export function buildGoogleMapsDirectionsFromCoordinatesHref(
    home: { lat: number; lng: number },
    stops: Array<{ lat: number; lng: number }>
): string | null {
    if (stops.length === 0) {
        return `https://www.google.com/maps/search/?api=1&query=${home.lat},${home.lng}`;
    }

    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1).map((stop) => `${stop.lat},${stop.lng}`);
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lng}`);
    url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
    if (waypoints.length > 0) {
        url.searchParams.set("waypoints", waypoints.join("|"));
    }
    url.searchParams.set("travelmode", "driving");
    return url.toString();
}

export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
```

- [ ] **Step 3: Replace local utilities in SchedulePage**

In SchedulePage.tsx, update the import from `scheduling.ts` (line 59) to include all the functions we're now importing:

```typescript
import {
    getHomeBase,
    calculateMilesBetweenCoordinates,
    toLocalIsoDate,
    parseLocalDate,
    todayIso,
    timeStringToMinutes,
    minutesToTimeString,
    formatAxisTime,
    isValidQuarterHour,
    estimateDriveMinutes,
    buildPhoneHref,
    buildGoogleMapsHref,
    buildAppleMapsHref,
    buildGoogleMapsDirectionsFromCoordinatesHref,
    orderByFarthestFromHome,
    isIOS,
    getWeekDates,
    SLOT_MINUTES,
    DAY_START_MINUTES,
    DAY_END_MINUTES,
    SLOT_HEIGHT_PX,
    MIN_DURATION_MINUTES,
    AVERAGE_DRIVE_SPEED_MPH,
} from "../utils/scheduling";
```

Then delete the local versions (lines 53-58, 96-228). Keep the following that are NOT duplicated:
- `APPOINTMENTS_SYNCED_EVENT`, `DAY_NOTES_SYNCED_EVENT`, `REQUEST_SYNC_EVENT` (lines 60-62)
- `triggerSync` (lines 64-66)
- `ClearedWeekAppointmentSnapshot`, `ClearedWeekSnapshot` interfaces (lines 68-86)
- `DayMapPoint` interface (lines 88-94)

Also remove the local constant declarations for `SLOT_MINUTES`, `DAY_START_MINUTES`, `DAY_END_MINUTES`, `SLOT_HEIGHT_PX`, `MIN_DURATION_MINUTES`, `AVERAGE_DRIVE_SPEED_MPH` (lines 53-58) — these now come from the import.

Also rename `parseIsoDate(...)` calls to `parseLocalDate(...)` and `todayIso()` calls to use the import (the function name is the same, just no longer local).

- [ ] **Step 4: Verify build**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add pt-scheduler/src/utils/scheduling.ts pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: deduplicate SchedulePage utilities into scheduling.ts"
```

---

### Task 1: Extract `useLocationData` hook (~250 lines)

**Files:**
- Create: `pt-scheduler/src/hooks/useLocationData.ts`
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx`

- [ ] **Step 1: Create `useLocationData.ts`**

Create `pt-scheduler/src/hooks/useLocationData.ts`. This hook contains all geocoding, distance matrix, and leg info logic. The full implementation is a direct move of the code from SchedulePage lines 303-310, 316-319, 421-458, 617-872.

The hook signature:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Patient } from "../types";
import { geocodeAddress } from "../api/geocode";
import { getDistanceMatrix } from "../api/distance";
import {
    getHomeBase,
    calculateMilesBetweenCoordinates,
    estimateDriveMinutes,
} from "../utils/scheduling";

export interface LegInfo {
    miles: number | null;
    minutes: number | null;
    fromHome: boolean;
    isRealDistance: boolean;
}

interface LocationDataResult {
    homeCoordinates: { lat: number; lng: number } | null;
    resolvedPatientCoordinates: Record<string, { lat: number; lng: number }>;
    getPatientCoordinates: (patientId: string) => { lat: number; lng: number } | null;
    resolvePatientCoordinatesForRouting: (patientId: string) => Promise<{ lat: number; lng: number } | null>;
    legInfoByAppointmentId: Record<string, LegInfo>;
    selectedDayEstimatedDriveMinutes: number;
    drivingDistances: Record<string, { miles: number; minutes: number }>;
}

export function useLocationData(
    appointments: Appointment[],
    patientById: Map<string, Patient>,
    appointmentsByDay: Record<string, Appointment[]>,
    selectedDayAppointments: Appointment[],
): LocationDataResult {
    // Move ALL of the following from SchedulePage into this function body:
    // - homeCoordinates useState (line 303)
    // - resolvedPatientCoordinates useState (line 307)
    // - patientGeocodeInFlightRef useRef (line 310)
    // - drivingDistances useState (line 316)
    // - distanceFetchInFlightRef useRef (line 319)
    // - loadHomeCoordinates useEffect (lines 421-458)
    // - geocodePatients useEffect (lines 617-675)
    // - fetchDrivingDistances useEffect (lines 678-755)
    // - getPatientCoordinates function (lines 757-766)
    // - resolvePatientCoordinatesForRouting useCallback (lines 768-798)
    // - legInfoByAppointmentId useMemo (lines 800-865)
    // - selectedDayEstimatedDriveMinutes useMemo (lines 867-872)

    // Return all values the rest of SchedulePage needs:
    return {
        homeCoordinates,
        resolvedPatientCoordinates,
        getPatientCoordinates,
        resolvePatientCoordinatesForRouting,
        legInfoByAppointmentId,
        selectedDayEstimatedDriveMinutes,
        drivingDistances,
    };
}
```

Move the code exactly as-is from SchedulePage — no logic changes.

- [ ] **Step 2: Update SchedulePage to use the hook**

In SchedulePage.tsx:

1. Add import: `import { useLocationData } from "../hooks/useLocationData";`
2. Delete lines 303-310, 316-319 (state declarations for homeCoordinates, resolvedPatientCoordinates, patientGeocodeInFlightRef, drivingDistances, distanceFetchInFlightRef)
3. Delete lines 421-458 (loadHomeCoordinates effect)
4. Delete lines 617-872 (geocode effect, distance matrix effect, getPatientCoordinates, resolvePatientCoordinatesForRouting, legInfoByAppointmentId, selectedDayEstimatedDriveMinutes)
5. After BOTH `patientById` AND `appointmentsByDay` memos are declared, add the hook call (the hook takes `appointmentsByDay` as a parameter, so it must come after):

```typescript
const {
    homeCoordinates,
    resolvedPatientCoordinates,
    getPatientCoordinates,
    resolvePatientCoordinatesForRouting,
    legInfoByAppointmentId,
    selectedDayEstimatedDriveMinutes,
    drivingDistances,
} = useLocationData(appointments, patientById, appointmentsByDay, selectedDayAppointments);
```

All downstream code that references these variables continues to work unchanged.

6. **Clean up now-unused imports** from SchedulePage: remove `geocodeAddress` (from `../api/geocode`), `getDistanceMatrix` (from `../api/distance`), and any scheduling.ts imports that are no longer used directly (e.g., `calculateMilesBetweenCoordinates`, `estimateDriveMinutes` if only used in the extracted code). TypeScript strict mode will flag these as errors — fix all unused imports until the build passes.

- [ ] **Step 3: Verify build**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds. If unused import errors occur, remove those imports.

- [ ] **Step 4: Manual test**

Open the app. Verify:
- Appointment chips show miles and drive time
- "Map Day" button still works
- Optimize button still reorders appointments

- [ ] **Step 5: Commit**

```bash
git add pt-scheduler/src/hooks/useLocationData.ts pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: extract useLocationData hook from SchedulePage"
```

---

### Task 2: Extract `AddAppointmentModal` component (~350 lines)

**Files:**
- Create: `pt-scheduler/src/components/AddAppointmentModal.tsx`
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx`

- [ ] **Step 1: Create `AddAppointmentModal.tsx`**

Create `pt-scheduler/src/components/AddAppointmentModal.tsx`. The component manages its own form state internally and initializes from props when it opens.

```typescript
import { useEffect, useState } from "react";
import { useAppointmentStore } from "../stores";
import { Button } from "./ui/Button";
import { VisitTypeSelect } from "./ui/VisitTypeSelect";
import { X } from "lucide-react";
import type { Patient, VisitType } from "../types";
import {
    PERSONAL_PATIENT_ID,
    PERSONAL_CATEGORIES,
    getPersonalCategoryLabel,
} from "../utils/personalEventColors";
import {
    toLocalIsoDate,
    isValidQuarterHour,
    SLOT_MINUTES,
} from "../utils/scheduling";

interface AddAppointmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    patients: Patient[];
    defaultDate: string;
    defaultTime?: string;
    defaultIsPersonal?: boolean;
    onCreated: (date: string) => void;
}

export function AddAppointmentModal({
    isOpen,
    onClose,
    patients,
    defaultDate,
    defaultTime,
    defaultIsPersonal,
    onCreated,
}: AddAppointmentModalProps) {
    const { create } = useAppointmentStore();

    // Form state — all local to this component
    const [patientId, setPatientId] = useState("");
    const [appointmentDate, setAppointmentDate] = useState(defaultDate);
    const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
    const [duration, setDuration] = useState(60);
    const [visitType, setVisitType] = useState<VisitType>(null);
    const [isPersonalEvent, setIsPersonalEvent] = useState(defaultIsPersonal ?? false);
    const [personalCategory, setPersonalCategory] = useState("lunch");
    const [personalTitle, setPersonalTitle] = useState("");
    const [repeatInterval, setRepeatInterval] = useState<"none" | "weekly" | "biweekly">("none");
    const [repeatUntil, setRepeatUntil] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Initialize/reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setAppointmentDate(defaultDate);
            if (defaultTime) setStartTime(defaultTime);
            setIsPersonalEvent(defaultIsPersonal ?? false);
            setPersonalCategory("lunch");
            setPersonalTitle("");
            setRepeatInterval("none");
            setRepeatUntil("");
            setError(null);
            setIsSaving(false);
        }
    }, [isOpen, defaultDate, defaultTime, defaultIsPersonal]);

    // Auto-select first active patient when patient list changes
    useEffect(() => {
        if (patients.length === 0) {
            setPatientId("");
            return;
        }
        const exists = patients.some((p) => p.id === patientId);
        if (!exists) {
            const firstActive = patients.find(
                (p) => p.status === "active" || p.status === "evaluation"
            );
            setPatientId((firstActive || patients[0]).id);
        }
    }, [patients, patientId]);

    // Move the ENTIRE handleCreateAppointment function here (from SchedulePage lines 966-1052)
    // with these changes:
    // - Replace newPatientId → patientId, newAppointmentDate → appointmentDate, etc.
    // - Replace setSelectedDate(newAppointmentDate) + setIsAddOpen(false) + form resets + triggerSync()
    //   with: onCreated(appointmentDate); onClose();
    // - Replace setAddError → setError, setIsSaving stays the same

    // Move the ENTIRE modal JSX here (from SchedulePage lines 3349-3598)
    // with the same variable renames

    if (!isOpen) return null;

    const handleClose = () => {
        setError(null);
        setIsSaving(false);
        onClose();
    };

    const handleCreate = async () => {
        // ... validation + create logic from SchedulePage lines 966-1052
        // On success: onCreated(appointmentDate); onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={handleClose}
        >
            {/* ... rest of modal JSX from SchedulePage lines 3354-3597 */}
        </div>
    );
}
```

The full JSX is a direct copy from SchedulePage lines 3349-3598 with variable renames (`newPatientId` → `patientId`, `cancelAddAppointment` → `handleClose`, etc.).

- [ ] **Step 2: Update SchedulePage to use `AddAppointmentModal`**

In SchedulePage.tsx:

1. Add import: `import { AddAppointmentModal } from "../components/AddAppointmentModal";`
2. Delete form state declarations: `newPatientId`, `newAppointmentDate`, `newStartTime`, `newDuration`, `newVisitType`, `newIsPersonalEvent`, `newPersonalCategory`, `newPersonalTitle`, `newRepeatInterval`, `newRepeatUntil`, `addError`, `isSaving` (lines ~241-254)
3. Add prefill state:
```typescript
const [isAddOpen, setIsAddOpen] = useState(false);
const [addPrefillDate, setAddPrefillDate] = useState(selectedDate);
const [addPrefillTime, setAddPrefillTime] = useState<string | undefined>();
const [addPrefillIsPersonal, setAddPrefillIsPersonal] = useState(false);
```
4. Simplify `openAddAppointment`:
```typescript
const openAddAppointment = (prefillDate = selectedDate, prefillTime?: string) => {
    void loadAll();
    setSelectedDate(prefillDate);
    setAddPrefillDate(prefillDate);
    setAddPrefillTime(prefillTime);
    setAddPrefillIsPersonal(false);
    setIsAddOpen(true);
};
```
5. Delete `cancelAddAppointment` (lines 961-964)
6. Delete `handleCreateAppointment` (lines 966-1052)
7. Delete patient selection sync effect (lines 460-473)
8. Replace the modal JSX (lines 3348-3598) with:
```tsx
<AddAppointmentModal
    isOpen={isAddOpen}
    onClose={() => setIsAddOpen(false)}
    patients={patients}
    defaultDate={addPrefillDate}
    defaultTime={addPrefillTime}
    defaultIsPersonal={addPrefillIsPersonal}
    onCreated={(date) => {
        setSelectedDate(date);
        triggerSync();
    }}
/>
```
9. The FAB button (lines 3601-3607) and SlotActionMenu callbacks stay unchanged — they call `openAddAppointment`.
10. **Clean up now-unused imports** from SchedulePage: remove `VisitTypeSelect` import, and any other imports only used by the extracted modal code. TypeScript strict mode will flag these.

- [ ] **Step 3: Verify build**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds. If unused import errors occur, remove those imports.

- [ ] **Step 4: Manual test**

Open the app. Verify:
- FAB opens the modal, fill form, save → appointment appears
- Long-press slot → "Add Appointment" → modal opens with time prefill
- Create a personal event with repeat
- Patient dropdown shows active patients, grouped

- [ ] **Step 5: Commit**

```bash
git add pt-scheduler/src/components/AddAppointmentModal.tsx pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: extract AddAppointmentModal from SchedulePage"
```

---

### Task 3: Extract `DayMapModal` component (~250 lines)

**Files:**
- Create: `pt-scheduler/src/components/DayMapModal.tsx`
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx`

- [ ] **Step 1: Create `DayMapModal.tsx`**

Create `pt-scheduler/src/components/DayMapModal.tsx`. The component manages all Leaflet map state internally.

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { X } from "lucide-react";
import type { Appointment, Patient } from "../types";
import { getHomeBase, buildGoogleMapsDirectionsFromCoordinatesHref } from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";
import "leaflet/dist/leaflet.css";

interface DayMapPoint {
    id: string;
    label: string;
    lat: number;
    lng: number;
    isHome: boolean;
}

interface DayMapModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedDate: string;
    selectedDayAppointments: Appointment[];
    homeCoordinates: { lat: number; lng: number } | null;
    getPatient: (id: string) => Patient | undefined;
    resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>;
}

export function DayMapModal({
    isOpen,
    onClose,
    selectedDate,
    selectedDayAppointments,
    homeCoordinates,
    getPatient,
    resolvePatientCoordinatesForRouting,
}: DayMapModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);
    const [points, setPoints] = useState<DayMapPoint[]>([]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
    const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

    // Move handleOpenDayMap logic here (SchedulePage lines 1857-1945)
    // Runs as an effect when isOpen becomes true
    useEffect(() => {
        if (!isOpen) return;
        // ... same logic as handleOpenDayMap, operating on local state
    }, [isOpen, selectedDayAppointments, homeCoordinates]);

    // Move dayMapDirectionsHref memo here (SchedulePage lines 2377-2390)
    const directionsHref = useMemo(() => {
        // ... same logic
    }, [points]);

    // Move Leaflet render effect here (SchedulePage lines 2392-2480)
    useEffect(() => {
        // ... same logic, referencing local refs
    }, [isOpen, points]);

    // Move Leaflet cleanup effect here (SchedulePage lines 2482-2488)
    useEffect(() => {
        return () => {
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
            layerRef.current = null;
        };
    }, []);

    const handleClose = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        // Move JSX from SchedulePage lines 3282-3346
        // Replace: isDayMapLoading → isLoading, dayMapError → error,
        // dayMapInfoMessage → infoMessage, dayMapContainerRef → containerRef,
        // dayMapDirectionsHref → directionsHref, handleCloseDayMap → handleClose
    );
}
```

Note: `isPersonalEvent` must be imported from utils. It was previously imported from `personalEventColors` in SchedulePage — during the utility dedup (Task 0) it should already be available. If not, import from `../utils/personalEventColors`.

- [ ] **Step 2: Update SchedulePage to use `DayMapModal`**

In SchedulePage.tsx:

1. Add import: `import { DayMapModal } from "../components/DayMapModal";`
2. Delete state: `isDayMapLoading`, `dayMapError`, `dayMapInfoMessage`, `dayMapPoints`, `dayMapContainerRef`, `dayMapInstanceRef`, `dayMapLayerRef` (lines 340-346)
3. Delete `DayMapPoint` interface (lines 88-94) — now in DayMapModal
4. Delete `handleOpenDayMap` (lines 1857-1945)
5. Delete `handleCloseDayMap` (lines 1947-1954)
6. Delete `dayMapDirectionsHref` memo (lines 2377-2390)
7. Delete Leaflet render effect (lines 2392-2480)
8. Delete Leaflet cleanup effect (lines 2482-2488)
9. Keep `isDayMapOpen` state. Replace the modal JSX (lines 3281-3346) with:

```tsx
<DayMapModal
    isOpen={isDayMapOpen}
    onClose={() => setIsDayMapOpen(false)}
    selectedDate={selectedDate}
    selectedDayAppointments={selectedDayAppointments}
    homeCoordinates={homeCoordinates}
    getPatient={getPatient}
    resolvePatientCoordinatesForRouting={resolvePatientCoordinatesForRouting}
/>
```

10. Update "Map Day" button in header to call `setIsDayMapOpen(true)` (it was calling `handleOpenDayMap` before — the open logic now runs as an effect inside the component when `isOpen` becomes true).
11. **Clean up now-unused imports** from SchedulePage: remove `"leaflet/dist/leaflet.css"` import if no other Leaflet usage remains. TypeScript strict mode will flag unused variable imports.

**Note on DayMapModal effect deps:** The "open map" effect inside DayMapModal references `getPatient` and `resolvePatientCoordinatesForRouting` from props. Include these in the effect's dependency array to satisfy React exhaustive-deps, or wrap the effect body in a function called from a handler.

- [ ] **Step 3: Verify build**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds. If unused import errors occur, remove those imports.

- [ ] **Step 4: Manual test**

Open the app. Verify:
- Click "Map Day" → map opens with markers
- Click "Open in Google Maps" → directions link opens
- Close and reopen on different day
- Day with no appointments shows error message

- [ ] **Step 5: Commit**

```bash
git add pt-scheduler/src/components/DayMapModal.tsx pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: extract DayMapModal from SchedulePage"
```

---

### Task 4: Extract `useWeekActions` hook (~250 lines)

**Files:**
- Create: `pt-scheduler/src/hooks/useWeekActions.ts`
- Modify: `pt-scheduler/src/pages/SchedulePage.tsx`

- [ ] **Step 1: Create `useWeekActions.ts`**

Create `pt-scheduler/src/hooks/useWeekActions.ts`:

```typescript
import { useState } from "react";
import { useAppointmentStore } from "../stores";
import { useScheduleStore } from "../stores";
import { db } from "../db/schema";
import type { Appointment } from "../types";
import { getHomeBase, orderByFarthestFromHome } from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";

// Import triggerSync from a shared location. If not already exported,
// extract the constant + function from SchedulePage into a shared file
// (e.g., src/utils/syncEvents.ts) or import directly from SchedulePage.
// For simplicity, redefine locally — same pattern as SchedulePage:
const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";
const triggerSync = () => {
    window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
};

interface ClearedWeekAppointmentSnapshot {
    patientId: string;
    date: string;
    startTime: string;
    duration: number;
    status: Appointment["status"];
    notes?: string;
    chipNote?: string;
    chipNotes?: string[];
    chipNoteColor?: string;
    personalCategory?: string;
    title?: string;
}

interface ClearedWeekSnapshot {
    weekStart: string;
    weekEnd: string;
    appointments: ClearedWeekAppointmentSnapshot[];
}

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

export function useWeekActions(
    weekDates: string[],
    appointmentsByDay: Record<string, Appointment[]>,
    homeCoordinates: { lat: number; lng: number } | null,
    resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>,
    resetInteractionState: () => void,
): WeekActionsResult {
    const { create, update, delete: deleteAppointment, loadByRange } = useAppointmentStore();
    const { setSelectedDate } = useScheduleStore();

    const [lastClearedWeekSnapshot, setLastClearedWeekSnapshot] = useState<ClearedWeekSnapshot | null>(null);
    const [weekActionInProgress, setWeekActionInProgress] = useState(false);
    const [weekActionMessage, setWeekActionMessage] = useState<string | null>(null);
    const [weekActionError, setWeekActionError] = useState<string | null>(null);
    const [autoArrangeInProgressByDay, setAutoArrangeInProgressByDay] = useState<Record<string, boolean>>({});
    const [autoArrangeError, setAutoArrangeError] = useState<string | null>(null);

    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];

    // Move handleAutoArrangeDay here EXACTLY from SchedulePage lines 1618-1710
    // Replace: loadByRange(weekStart, weekEnd) uses local weekStart/weekEnd
    // Replace: setSelectedDate(date) uses store action from above
    const handleAutoArrangeDay = async (date: string) => {
        // ... exact code from SchedulePage lines 1618-1710
    };

    // Move handleClearWeek here EXACTLY from SchedulePage lines 1712-1798
    // Replace lines 1739-1743 (direct state resets) with:
    //     resetInteractionState();
    const handleClearWeek = async () => {
        // ... exact code from SchedulePage lines 1712-1798
        // but line 1739-1743 becomes: resetInteractionState();
    };

    // Move handleUndoClearWeek here EXACTLY from SchedulePage lines 1800-1855
    const handleUndoClearWeek = async () => {
        // ... exact code from SchedulePage lines 1800-1855
    };

    return {
        lastClearedWeekSnapshot,
        weekActionInProgress,
        weekActionMessage,
        weekActionError,
        autoArrangeInProgressByDay,
        autoArrangeError,
        handleClearWeek,
        handleUndoClearWeek,
        handleAutoArrangeDay,
    };
}
```

- [ ] **Step 2: Update SchedulePage to use the hook**

In SchedulePage.tsx:

1. Add import: `import { useWeekActions } from "../hooks/useWeekActions";`
2. Delete `ClearedWeekAppointmentSnapshot` and `ClearedWeekSnapshot` interfaces (lines 68-86)
3. Delete state: `autoArrangeInProgressByDay`, `autoArrangeError`, `lastClearedWeekSnapshot`, `weekActionInProgress`, `weekActionMessage`, `weekActionError` (lines 253-257, 335-338)
4. Delete functions: `handleAutoArrangeDay` (lines 1618-1710), `handleClearWeek` (lines 1712-1798), `handleUndoClearWeek` (lines 1800-1855)
5. Add the `resetInteractionState` callback and hook call:

```typescript
const resetInteractionState = useCallback(() => {
    setMoveAppointmentId(null);
    setDraggingAppointmentId(null);
    setResizingAppointmentId(null);
    setDetailAppointmentId(null);
    setDraftRenderById({});
}, []);

const {
    lastClearedWeekSnapshot,
    weekActionInProgress,
    weekActionMessage,
    weekActionError,
    autoArrangeInProgressByDay,
    autoArrangeError,
    handleClearWeek,
    handleUndoClearWeek,
    handleAutoArrangeDay,
} = useWeekActions(
    weekDates,
    appointmentsByDay,
    homeCoordinates,
    resolvePatientCoordinatesForRouting,
    resetInteractionState,
);
```

All downstream JSX that references these variables continues to work unchanged.

6. **Clean up now-unused imports** from SchedulePage: remove `db` import (from `../db/schema`) if no other direct DB access remains. Remove any other imports that became unused. TypeScript strict mode will flag these.

- [ ] **Step 3: Verify build**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds. If unused import errors occur, remove those imports.

- [ ] **Step 4: Manual test**

Open the app. Verify:
- Click "Optimize" on a day with 2+ appointments → reorders by distance
- Click "Clear Week" → confirms, clears all, shows undo
- Click "Undo" → restores appointments
- Error states display correctly

- [ ] **Step 5: Commit**

```bash
git add pt-scheduler/src/hooks/useWeekActions.ts pt-scheduler/src/pages/SchedulePage.tsx
git commit -m "refactor: extract useWeekActions hook from SchedulePage"
```

---

### Task 5: Final verification and deploy

**Files:**
- No new files

- [ ] **Step 1: Full build check**

Run: `cd pt-scheduler && npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Line count check**

Run: `wc -l pt-scheduler/src/pages/SchedulePage.tsx`
Expected: ~2500-2700 lines (down from 3803).

- [ ] **Step 3: Deploy**

```bash
cd pt-scheduler && npm run build
cd ..
git add -A && git commit -m "refactor: complete SchedulePage decomposition (low-risk phase)"
git push origin main
cd pt-scheduler && vercel --prod
```
