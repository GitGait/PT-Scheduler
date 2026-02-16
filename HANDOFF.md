# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-15

### What Was Done
- **Full codebase cohesion review — Batches 0-3 (12 commits)**
  - **Batch 0:** Committed pending Personal pseudo-patient hiding (useSync.ts, PatientsPage.tsx)
  - **Batch 1a:** Deduplicated Haversine distance function — removed copies from SchedulePage.tsx and ScanPage.tsx, now single source in `utils/scheduling.ts`
  - **Batch 1b:** Removed unused `recurringBlockStore` and `calendarEventStore` Zustand stores (189 lines deleted)
  - **Batch 1c:** Replaced hardcoded hex colors with CSS custom properties in SchedulePage.tsx (map markers, ghost chip, external events) and Sidebar.tsx (calendar checkboxes)
  - **Batch 1d:** Added Space key handler to Card.tsx for WCAG keyboard accessibility
  - **Batch 2a:** Added `fetchWithTimeout()` helper in `api/request.ts`, wrapped all 13 raw fetch() calls in sheets.ts and calendar.ts with timeout protection (30s default, 60s for batch operations)
  - **Batch 2b:** Standardized Calendar API error handling with shared `getCalendarErrorMessage()` helper
  - **Batch 2c:** Added Zod schemas for Google Sheets/Calendar API responses in `utils/validation.ts`, replaced `as Type` casts with `parseWithSchema()` validation
  - **Batch 2d:** Added timeout to AI patient matching endpoint in `utils/matching.ts`
  - **Batch 3a:** Extended `calendarSyncLockRef` to also cover `backfillLocalAppointmentsToCalendar` — prevents concurrent calendar operations
  - **Batch 3b:** Added deleted patient tracking via localStorage — `trackDeletedPatientId()` and `getDeletedPatientIds()` in `db/operations.ts`, checked during calendar sync to prevent recreation
  - **Batch 3c:** Replaced `Record<string, unknown>` in SyncQueueItem with discriminated union type keyed on entity field — `SyncQueueDataAppointment`, `SyncQueueDataPatient`, `SyncQueueDataCalendarEvent`
- All 12 commits deployed to Vercel production

### Recent Commits
```
80b2366 Strengthen SyncQueueItem data typing with discriminated union
ff7c27d Prevent deleted patients from being recreated by calendar sync
a717cb2 Extend calendar sync lock to cover backfill operation
f852134 Add timeout protection to AI patient matching endpoint
4e6c917 Add Zod schemas for Google Sheets and Calendar API responses
```

### Blocking Issue
- **Distance Matrix API returns `REQUEST_DENIED`** — the API is NOT enabled in Google Cloud Console
  - User needs to enable "Distance Matrix API" at console.cloud.google.com → APIs & Services → Library
  - Once enabled, mileage will automatically switch from Haversine to real driving distances

### Known Issues / Next Steps
- Enable Distance Matrix API in Google Cloud Console (blocking real driving distances)
- Vercel auto-deploy from git push not working — check GitHub integration settings
- Touch drag should be tested on actual mobile device to confirm feel
- Consider auto-scroll when dragging to edge of viewport
- **Batch 4 (future):** SchedulePage.tsx extraction (useDragAppointment, useResizeAppointment, usePinchZoom hooks), PatientsPage.tsx CSV extraction, useSync.ts splitting, direct Dexie access consolidation
- Resize handle touch area overlaps chip touch area (both handlers fire) - not causing issues but could be cleaner
- Pre-existing test failures: ErrorBoundary.test.tsx (missing beforeEach), pages.test.tsx (mock gaps for RoutePage, SettingsPage)

## App Status
All 8 phases (0-7) complete. App is functional with: schedule calendar, patient management, OCR scan import, route optimization, Google calendar/sheets sync, theming, PWA, **personal events with recurrence**, **on-hold appointments**. Currently in bug-fix/polish phase. Deployed to Vercel at https://pt-scheduler-one.vercel.app.
