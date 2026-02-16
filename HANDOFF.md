# PT Scheduler - Session Handoff

> Read this + `CLAUDE.md` at session start. Update before session end.

## Last Session: 2026-02-15

### What Was Done
- **Improved Google Auth session persistence** — token no longer silently expires
  - Added proactive refresh timer in `auth.ts` — schedules silent token renewal 5 min before expiry
  - `scheduleTokenRefresh()` runs after every `setToken()` call and on restored tokens from localStorage
  - On refresh failure: clears token and dispatches `AUTH_STATE_CHANGED_EVENT` so UI updates
  - Moved `AUTH_STATE_CHANGED_EVENT` constant to `auth.ts` (canonical home), re-exported from `SettingsPage.tsx`
  - `TopNav.tsx` visibility handler now calls `tryRestoreSignIn()` (actual refresh) instead of just `isSignedIn()` (status check)
  - Files modified: `api/auth.ts`, `components/ui/TopNav.tsx`, `pages/SettingsPage.tsx`
- Commit: `9b46be7`
- Deployed to Vercel production

### Recent Commits
```
9b46be7 Improve Google Auth session persistence with proactive token refresh
d58626f Add patient-level persistent chip notes
d4c33d2 Fix Google Calendar sync overwriting on-hold status
ad843ab Add chip quick notes feature for per-appointment annotations
f4cbf84 Fix on-hold appointments not persisting across page refresh
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
