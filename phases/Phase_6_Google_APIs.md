# Phase 6: Google APIs Integration

> Goal: integrate Google OAuth, Sheets patient sync, and Calendar appointment sync.

## Prerequisites

- Phases 0-5 complete
- Google Cloud OAuth and APIs configured

## 6.1 Auth

Create `src/api/auth.ts`:
- init Google Identity Services (GIS) using the `google.accounts.oauth2.initTokenClient` API
- request access token with these specific scopes:

```ts
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",   // read + write Sheets
  "https://www.googleapis.com/auth/calendar.events", // create/update/delete Calendar events
].join(" ");
```

Load the GIS script in `index.html`:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

Token flow:
1. Call `google.accounts.oauth2.initTokenClient({ client_id, scope: SCOPES, callback })`.
2. On callback, store the access token in memory (not localStorage — it's short-lived).
3. Refresh by calling `tokenClient.requestAccessToken()` again when a 401 is received.

## 6.2 Sheets API (`src/api/sheets.ts`)

Implement:
- fetch patients from `Patients` tab
- upsert by stable patient ID
- export week schedule tab

Validate all response payloads and check `res.ok` on each request.

## 6.3 Calendar API (`src/api/calendar.ts`)

Implement:
- create event
- update event
- delete event

Always check `res.ok` and surface actionable errors.

## 6.4 Sync Hook (`src/hooks/useSync.ts`)

- initial patient sync on app load when online
- process queue items to Sheets/Calendar

## 6.5 Queue hardening

- max batch size: 5 items
- 2-3 second delay between batches
- exponential backoff on failure
- max retries: 5
- idempotency key usage for create operations
- soft cap: <= 50 Sheets requests/min

## Verification

- sign-in works
- patients pull from Sheets and upsert back correctly
- appointments create/update/delete in Calendar
- queue respects batch, retry, and idempotency rules

## Next Phase

-> **[Phase_7_Testing_and_Deploy.md](./Phase_7_Testing_and_Deploy.md)**
