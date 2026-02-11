# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-11

### What Was Done
- **Fixed scroll position reset when dragging appointment chips** (persistent issue from prior session)
  - Root cause: `loadByRange()` set `loading: true`, which swapped the entire calendar grid for `<ScheduleGridSkeleton/>`. This destroyed the scroll container's DOM content and reset `scrollTop` to 0. The previous fix (rendersLeft: 6) was insufficient because side effects (geocoding, distance calc) consumed the render budget before the grid was restored.
  - Fix 1 (primary): Only show skeleton on initial load — changed `{loading ? skeleton : grid}` to `{loading && appointments.length === 0 ? skeleton : grid}` in SchedulePage.tsx line 2210
  - Fix 2: `loadByRange` in appointmentStore.ts now only sets `loading: true` when no appointments exist (initial load), keeping existing appointments visible during refreshes
  - Fix 3: Increased `rendersLeft` from 6 to 20 across all 5 scroll preservation points
  - Fix 4: `handleAppointmentDragEnd` now calls `event.preventDefault()` to prevent browser-default scroll behavior
  - Commit: `629ac0d`
  - Deployed to Vercel production

### Blocking Issue
- **Distance Matrix API returns `REQUEST_DENIED`** — the API is NOT enabled in Google Cloud Console
  - User needs to enable "Distance Matrix API" at console.cloud.google.com → APIs & Services → Library
  - Once enabled, mileage will automatically switch from Haversine to real driving distances
  - `GOOGLE_MAPS_API_KEY` env var IS set on Vercel, just needs the API enabled

### Recent Commits
```
629ac0d Fix scroll position reset when dragging appointment chips
09eeb74 Add copy & paste appointment chips feature
cfd818f Add copy buttons for phone numbers and addresses in action sheet
2eb3138 Fix distance calculations using Haversine instead of Distance Matrix API
1a43724 Fix chip positioning and scroll reset after drag-drop
19393d1 Fix appointment chip positioning - remove position:relative override
```

### Known Issues / Next Steps
- Enable Distance Matrix API in Google Cloud Console (blocking real driving distances)
- Vercel auto-deploy from git push not working — check GitHub integration settings
- Touch drag should be tested on actual mobile device to confirm feel
- Consider auto-scroll when dragging to edge of viewport
- SchedulePage.tsx is ~2800 lines - could benefit from extracting components
- Resize handle touch area overlaps chip touch area (both handlers fire) - not causing issues but could be cleaner
- Pre-existing test failures: ErrorBoundary.test.tsx (missing beforeEach), pages.test.tsx (mock gaps for RoutePage, SettingsPage)

## App Status
All 8 phases (0-7) complete. App is functional with: schedule calendar, patient management, OCR scan import, route optimization, Google calendar/sheets sync, theming, PWA. Currently in bug-fix/polish phase. Deployed to Vercel at https://pt-scheduler-one.vercel.app.
