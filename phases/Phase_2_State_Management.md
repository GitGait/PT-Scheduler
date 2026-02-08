# Phase 2: State Management

> Goal: add Zustand stores over local DB operations and online/offline state.

## Prerequisites

- Phases 0-1 complete

## Stores

Create:
- `patientStore.ts`
- `appointmentStore.ts`
- `syncStore.ts`
- `recurringBlockStore.ts`
- `calendarEventStore.ts`
- `index.ts` exports

## Required Behavior

- `patientStore`: load/search/get by id.
- `appointmentStore`: load by day/week/range + create/update/delete + mark complete.
- `syncStore`: online flag from browser + pending queue count.
- `recurringBlockStore` and `calendarEventStore`: CRUD over local DB.

Register online/offline listeners once at module scope in `syncStore.ts`.

## Verification

- App reflects offline/online transitions.
- Store methods update local state and DB in sync.

## Next Phase

-> **[Phase_3_Patient_Matching.md](./Phase_3_Patient_Matching.md)**
