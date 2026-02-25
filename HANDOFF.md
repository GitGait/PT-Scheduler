# Handoff

## Last Session — 2026-02-24

### What Was Done
- **PT19 added to auto-discharge logic** — `pt-scheduler/src/hooks/useAutoDischarge.ts` now treats PT19 (PT Discharge) visits the same as PT18 (OASIS Discharge) for auto-discharge. When a PT19 appointment's week ends (Saturday passes), the patient is moved to discharged status automatically.
  - Filter expanded from `PT18`-only to `PT18 || PT19`
  - Variable renamed `pt18Appointments` → `dischargeAppointments`
  - JSDoc/comments updated

### Recent Commits
```
5f1ac2f Include PT19 in auto-discharge logic alongside PT18
a8cd094 Fix recurring personal appointments not generating future instances
40c9c61 Fix drag snap-back: skip recently-pushed appointments during calendar pull
0b4c39c Fix drag snap-back race condition: await DB write before sync
365219e Fix desktop drag snap-back: use ref instead of state for dragging ID
```

### What's Next
- No pending tasks. App is in UI/UX polish phase.

### Gotchas
- None currently.
