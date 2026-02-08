# Home Health PT Scheduling App - Complete Specification

## App Overview

A Progressive Web App (PWA) for home health PT scheduling that:

- extracts appointments from screenshots
- matches patients with exact/fuzzy/AI strategies
- optimizes routes
- works offline first
- syncs patients to Google Sheets and appointments to Google Calendar

## Core Architecture

### Sources of truth

| Component | Responsibility |
|---|---|
| Google Sheets | Patient master data and backup export |
| IndexedDB (Dexie) | Primary local runtime data |
| Google Calendar | One-way appointment event push |

### Offline-first model

1. Local writes always succeed first (IndexedDB).
2. Sync queue stores remote operations.
3. Queue retries with backoff when online.
4. Manual conflict visibility exists in Settings.

## Core Features

1. AI screenshot OCR and bulk appointment creation.
2. Three-stage patient matching with confidence tiers.
3. Week/day scheduling UI with drag/drop and resize.
4. Route optimization with drive-time summary.
5. Patient management (active/discharged, multiple contacts).
6. Quick add from pasted referral text or pre-OCR PDF text.
7. PWA installability and offline usage on iPhone.

## Security and Reliability

- API keys only in environment variables.
- Client and server API error payloads standardized.
- Runtime response validation with Zod.
- Queue retries with max attempts and backoff.
- Idempotency keys on queue items to prevent duplicate creates.
- Optional error tracking (Sentry/log-based alerts).

## Accessibility Baseline

- keyboard access for primary desktop interactions
- aria labels for icon-only controls
- visible focus states
- status not represented by color only
- minimum touch targets of 44x44

## Development Phases

### Phase 0: Setup (30-45 min)
- initialize Vite React TypeScript app
- add dependencies and folder layout
- configure PWA and env template

### Phase 1: Types and database (45-60 min)
- define domain models and sync queue types
- configure Dexie stores and operations

### Phase 2: State management (30-45 min)
- create Zustand stores for patients/appointments/sync/events
- wire online/offline state

### Phase 3: Matching (20-30 min)
- implement exact + fuzzy + AI fallback matching
- confidence-tier result handling

### Phase 3.5: Hardening (40-60 min)
- add validation schemas and parser helper
- add API error helper utilities
- add global error boundary
- add queue retry/backoff/idempotency baseline
- add initial automated tests

### Phase 4: Serverless functions (45-60 min)
- build `/api/ocr`, `/api/optimize`, `/api/geocode`, `/api/extract-patient`, `/api/match-patient`
- enforce request/response validation + stable error contracts

### Phase 5: UI components (90-120 min)
- build schedule/route/patients/scan/settings pages
- integrate hardening UI items (sync conflicts section + accessibility baseline)

### Phase 6: Google APIs (60-90 min)
- Google OAuth
- Sheets read/upsert/export
- Calendar create/update/delete
- queue processing with batching, backoff, idempotency

### Phase 7: Testing and deploy (45-60 min)
- automated tests + manual end-to-end checklist
- API key restrictions and production OAuth setup
- Vercel deployment and post-deploy verification

**Total estimated time: 8-10 hours**

## Cost Summary (2026)

| Service | Typical monthly cost |
|---|---|
| Vercel | Free tier for MVP |
| OpenAI GPT-4o Mini | Low single-digit dollars for normal screenshot volume |
| Google Maps APIs | Depends on usage/quota; low for single-user MVP |
| Google Sheets + Calendar | Included with Google account |

Estimated operating range: **$1-$13/month** for typical MVP usage.

## Implementation Guide

Use files in `phases/`:

| Phase | File |
|---|---|
| 0 | `phases/Phase_0_Setup.md` |
| 1 | `phases/Phase_1_Types_and_Database.md` |
| 2 | `phases/Phase_2_State_Management.md` |
| 3 | `phases/Phase_3_Patient_Matching.md` |
| 3.5 | `phases/Phase_3_5_Hardening.md` |
| 4 | `phases/Phase_4_Serverless_Functions.md` |
| 5 | `phases/Phase_5_UI_Components.md` |
| 6 | `phases/Phase_6_Google_APIs.md` |
| 7 | `phases/Phase_7_Testing_and_Deploy.md` |

Work one phase at a time and verify phase handoff checks before proceeding.
