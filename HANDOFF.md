# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-15

### What Was Done
- **Added personal events to schedule grid**
  - Personal events (lunch, meeting, errand, personal, admin, other) appear on the calendar grid alongside patient appointments
  - Reuses all existing appointment infrastructure: drag, resize, sync queue, calendar push/pull, copy/paste, CRUD
  - Uses sentinel `patientId = "__personal__"` to distinguish from patient appointments
  - Files created: `src/utils/personalEventColors.ts` (categories, colors, helpers)
  - Files modified: `types/index.ts` (added `personalCategory`, `title` fields), `db/schema.ts` (version 3), `api/calendar.ts` (personal metadata keys + buildCalendarEvent), `hooks/useSync.ts` (detect/handle personal events in sync), `pages/SchedulePage.tsx` (modal toggle, chip rendering, auto-arrange exclusion, copy/paste, FAB always enabled), `components/AppointmentActionSheet.tsx` (hide Call/Text/Navigate for personal), `components/AppointmentDetailModal.tsx` (Title + Category editor for personal)
  - Each category has a distinct gradient color (warm orange, blue-gray, teal, purple, slate, neutral)
  - Auto-arrange excludes personal events (they stay pinned)
  - Distance calculations skip personal events (no address)
  - Google Calendar sync includes personal metadata for cross-device visibility
- Commit: `d17fd30`
- Deployed to Vercel production

### Recent Commits
```
d17fd30 Add personal events to schedule grid (lunch, meetings, errands, etc.)
a440390 Add ~ prefix for estimated distances and improve Distance Matrix logging
b520a0f Add NOMNC to visit type OCR matching and prefix parsing
40bf0cb Sync visitType to Google Calendar for cross-device visibility
a7ebb1c Replace default Vite favicon with PT Scheduler calendar icon
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
- SchedulePage.tsx is now ~3000+ lines - could benefit from extracting components
- Resize handle touch area overlaps chip touch area (both handlers fire) - not causing issues but could be cleaner
- Pre-existing test failures: ErrorBoundary.test.tsx (missing beforeEach), pages.test.tsx (mock gaps for RoutePage, SettingsPage)

## App Status
All 8 phases (0-7) complete. App is functional with: schedule calendar, patient management, OCR scan import, route optimization, Google calendar/sheets sync, theming, PWA, **personal events**. Currently in bug-fix/polish phase. Deployed to Vercel at https://pt-scheduler-one.vercel.app.
