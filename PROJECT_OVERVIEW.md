# PT Scheduling App - Project Overview

## What We Are Building

A Progressive Web App (PWA) for home health physical therapists to:

1. Scan schedule screenshots and extract visits with AI.
2. Match extracted names to known patients.
3. Add and manage appointments in week/day views.
4. Optimize daily driving routes.
5. Manage active/discharged patients and multiple contacts.
6. Sync patient data with Google Sheets and appointments with Google Calendar.
7. Work offline first with queued background sync.

## Primary User

- Solo home health PT
- iPhone-first workflow
- Receives schedule screenshots weekly
- Needs reliable offline behavior

## Core Decisions

| Decision | Rationale |
|---|---|
| PWA over native | Fast delivery, no app store friction, cross-device |
| IndexedDB local-first | Reliable offline usage |
| Google Sheets as patient source | Familiar and easy manual backup/edit |
| Google Calendar push | Existing reminder workflow |
| GPT-4o Mini for OCR/extraction | Lower cost, sufficient quality |
| Vercel serverless | Simple deployment and maintenance |

## Success Targets

- Weekly schedule entry reduced from 15-20 min to ~3 min
- Daily route planning reduced from 10-15 min to ~0 min
- Patient lookup under 5 seconds
- Daily admin time cut from ~45-60 min to ~10-15 min

## Updated Build Sequence

1. Phase 0: Setup
2. Phase 1: Types and database
3. Phase 2: State management
4. Phase 3: Matching
5. Phase 3.5: Hardening (validation, error contracts, queue resilience)
6. Phase 4: Serverless APIs
7. Phase 5: UI components
8. Phase 6: Google integrations
9. Phase 7: Testing and deploy

## Timeline

Estimated total: **8-10 hours** for MVP + hardening baseline.

## How To Use With AI Coding Assistants

1. Share `PROJECT_OVERVIEW.md` first for context.
2. Share one phase file at a time from `phases/`.
3. Ask for full implementation of that phase before moving on.
