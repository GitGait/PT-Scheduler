# PT Scheduling App - Phase Files

> Each phase is self-contained and can be given to any AI coding assistant independently.
>
> **Total Estimated Time:** 8-10 hours

## Development Phases

| Phase | File | Description | Time |
|---|---|---|---|
| 0 | [Phase_0_Setup.md](./Phase_0_Setup.md) | Project init, dependencies, PWA config | 30-45 min |
| 1 | [Phase_1_Types_and_Database.md](./Phase_1_Types_and_Database.md) | Types, Dexie schema, DB operations | 45-60 min |
| 2 | [Phase_2_State_Management.md](./Phase_2_State_Management.md) | Zustand stores and offline state | 30-45 min |
| 3 | [Phase_3_Patient_Matching.md](./Phase_3_Patient_Matching.md) | Exact + fuzzy + AI fallback matching | 20-30 min |
| 3.5 | [Phase_3_5_Hardening.md](./Phase_3_5_Hardening.md) | Validation, error contracts, queue resilience | 40-60 min |
| 4 | [Phase_4_Serverless_Functions.md](./Phase_4_Serverless_Functions.md) | OCR, optimize, geocode, extract, match APIs | 45-60 min |
| 5 | [Phase_5_UI_Components.md](./Phase_5_UI_Components.md) | Schedule/Route/Patients/Scan/Settings UI | 90-120 min |
| 6 | [Phase_6_Google_APIs.md](./Phase_6_Google_APIs.md) | OAuth, Sheets sync, Calendar sync | 60-90 min |
| 7 | [Phase_7_Testing_and_Deploy.md](./Phase_7_Testing_and_Deploy.md) | Automated + manual test pass, deploy | 45-60 min |

## Dependencies

```
Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 3.5 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7
```

## Handoff Contract

- Phase 0: app boots, routes render, env templates exist.
- Phase 1: DB schema + operations + smoke test complete.
- Phase 2: stores load/update local DB and online/offline flag works.
- Phase 3: matching utility compiles and can call AI fallback.
- Phase 3.5: runtime validators, API error helpers, retry/idempotency utilities, initial tests.
- Phase 4: all serverless routes return validated JSON + stable error payloads.
- Phase 5: end-to-end UI workflows render and work with local CRUD.
- Phase 6: Sheets/Calendar sync pipeline works with queue controls.
- Phase 7: tests pass and deployment validated on desktop + iPhone.

## Execution Note

For Phase 5, build base components first, then apply hardening passes (conflict checks, sync conflict UI, accessibility).
