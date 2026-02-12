# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-11

### What Was Done
- **Comprehensive dark mode fix across all pages and components**
  - Replaced hardcoded hex colors (#202124, #5f6368, #dadce0, #f1f3f4, #1a73e8, #d93025, #1e8e3e, etc.) with CSS custom properties (`--color-*`) and Tailwind `dark:` variants
  - Files fixed: AppointmentActionSheet.tsx, AppointmentDetailModal.tsx, SchedulePage.tsx, PatientsPage.tsx, PatientDetailPage.tsx, ScanPage.tsx, SettingsPage.tsx, Sidebar.tsx, index.css
  - Error/success/warning banners now use Tailwind color classes with dark variants
  - Status badges, icon circles, and decorative elements all theme-aware
- **Fixed stale current time indicator** in SchedulePage.tsx
  - Was `useMemo` with empty deps (never updated). Changed to `useState` + `useEffect` with 60-second interval
- **Fixed dark mode contrast** — `--color-text-tertiary` changed from `#80868b` to `#9ca3ab` in both dark theme blocks
- **Increased mini-calendar touch targets** — nav buttons from w-6 h-6 to w-9 h-9
- **Fixed iOS Safari input zoom** — `.input-google` font-size changed from `14px` to `max(16px, 0.875rem)`
- Commit: `67d0f55`
- Deployed to Vercel production

### Blocking Issue
- **Distance Matrix API returns `REQUEST_DENIED`** — the API is NOT enabled in Google Cloud Console
  - User needs to enable "Distance Matrix API" at console.cloud.google.com → APIs & Services → Library
  - Once enabled, mileage will automatically switch from Haversine to real driving distances
  - `GOOGLE_MAPS_API_KEY` env var IS set on Vercel, just needs the API enabled

### Recent Commits
```
67d0f55 Fix dark mode theming across all pages and components
629ac0d Fix scroll position reset when dragging appointment chips
09eeb74 Add copy & paste appointment chips feature
cfd818f Add copy buttons for phone numbers and addresses in action sheet
2eb3138 Fix distance calculations using Haversine instead of Distance Matrix API
1a43724 Fix chip positioning and scroll reset after drag-drop
```

### Remaining Hardcoded Colors (Acceptable)
- SchedulePage.tsx: Leaflet map marker colors (JS values for map pins, not UI theme)
- SchedulePage.tsx: Touch drag ghost gradient (inline style, can't use Tailwind)
- SchedulePage.tsx: Google Calendar event bgColor (comes from API response)

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
