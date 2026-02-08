# Phase 5: UI Components

> Goal: build user-facing pages and interactions for scheduling workflows.

## Prerequisites

- Phases 0-4 complete

## Core Pages

- `SchedulePage`
- `RoutePage`
- `PatientsPage`
- `ScanPage`
- `SettingsPage`
- `PatientDetailPage`

## Core Components

- bottom nav
- appointment card
- patient card
- image upload/crop
- swipeable row
- route stop card

## Required Interactions

- long-press add appointment
- drag/drop reschedule
- drag-to-resize duration
- conflict detection warning
- OCR result review with confidence tiers
- quick add from paste/PDF
- tap-to-call for primary + alternate contacts

## New Hardening UI Requirements

### Sync Conflicts section (Settings)

Show failed/conflicted queue items with:
- context (`entity`, `action`)
- last error message
- retry action
- dismiss action

### Accessibility baseline

- icon-only actions have `aria-label`
- keyboard reachable primary actions
- visible focus states
- status text not color-only
- min touch target 44x44

## Verification

- all pages render and navigate
- CRUD works locally
- sync conflicts section visible and actionable
- keyboard + touch checks pass

## Next Phase

-> **[Phase_6_Google_APIs.md](./Phase_6_Google_APIs.md)**
