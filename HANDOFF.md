# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-15

### What Was Done
- **Added on-hold appointments feature**
  - New `"on-hold"` status in `AppointmentStatus` union
  - `byStatus` query added to `appointmentDB` in `db/operations.ts`
  - Store actions: `loadOnHold`, `putOnHold`, `restoreFromHold` in `appointmentStore.ts`
  - `pendingRestoreFromHoldId` in `scheduleStore.ts` bridges Sidebar↔SchedulePage communication
  - "Put on Hold" button (amber, PauseCircle icon) in `AppointmentActionSheet.tsx`
  - Collapsible "On Hold" section in `Sidebar.tsx` with count badge, auto-expand/collapse, compact cards with amber left border
  - On-hold appointments filtered from calendar grid (`appointmentsByDay`, `appointmentCountsByDay`, `selectedDayAppointments`)
  - Restore flow: tap card in sidebar → `restoreFromHold()` changes status back to scheduled → enters move mode → user taps grid slot to place it
  - Files modified: `types/index.ts`, `db/operations.ts`, `stores/appointmentStore.ts`, `stores/scheduleStore.ts`, `components/AppointmentActionSheet.tsx`, `components/ui/Sidebar.tsx`, `pages/SchedulePage.tsx`
- Commit: `6032502`
- Deployed to Vercel production

### Recent Commits
```
6032502 Add on-hold appointments feature for temporarily shelving patients
06dd632 Add IDT Meeting category and recurring personal events
1a67bce Fix personal event colors to avoid clashing with PT visit type colors
d17fd30 Add personal events to schedule grid (lunch, meetings, errands, etc.)
a440390 Add ~ prefix for estimated distances and improve Distance Matrix logging
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
All 8 phases (0-7) complete. App is functional with: schedule calendar, patient management, OCR scan import, route optimization, Google calendar/sheets sync, theming, PWA, **personal events with recurrence**, **on-hold appointments**. Currently in bug-fix/polish phase. Deployed to Vercel at https://pt-scheduler-one.vercel.app.
