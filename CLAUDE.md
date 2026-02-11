# PT Scheduler - Project Context

## What This Is
Home health physical therapy scheduling PWA. Built and running. Currently in active UI/UX polish phase.

## Tech Stack
React 19 + Vite + TypeScript, Zustand state, Dexie.js (IndexedDB), React Router, Leaflet maps, Lucide icons, Tailwind CSS. PWA via vite-plugin-pwa. Google APIs for calendar/sheets/auth/distance.

## Commands
```bash
cd pt-scheduler
npm run dev      # Dev server
npm run build    # tsc + vite build (use to verify changes)
npm test         # Vitest
vercel --prod    # Deploy to production (run from pt-scheduler/)
```

## Deploy Rule
**Always deploy after completing changes.** Full sequence:
```bash
cd pt-scheduler
npm run build                          # 1. Verify build
cd ..
git add -A && git commit -m "message"  # 2. Commit
git push origin main                   # 3. Push to GitHub
cd pt-scheduler && vercel --prod       # 4. Deploy to Vercel
```
Do all four steps. Don't skip any. If build fails, fix it before committing.

## Key File Map

| What | Where |
|------|-------|
| **Main schedule calendar** | `pt-scheduler/src/pages/SchedulePage.tsx` (~2800 lines, custom calendar grid) |
| Types (Patient, Appointment, VisitType) | `pt-scheduler/src/types/index.ts` |
| Database schema + operations | `pt-scheduler/src/db/schema.ts`, `operations.ts` |
| Zustand stores (7 total) | `pt-scheduler/src/stores/` |
| API layer (auth, calendar, sheets, OCR, geocode, distance) | `pt-scheduler/src/api/` |
| Patient matching (3-stage) | `pt-scheduler/src/utils/matching.ts` |
| Validation schemas (Zod) | `pt-scheduler/src/utils/validation.ts` |
| App shell + routing | `pt-scheduler/src/App.tsx` |
| Global styles + CSS vars | `pt-scheduler/src/index.css` |
| UI components | `pt-scheduler/src/components/ui/` |
| Pages: Schedule, Patients, PatientDetail, Scan, Route, Settings | `pt-scheduler/src/pages/` |
| Phase specs (reference only) | `phases/Phase_*.md` |

## Architecture Patterns
- **SchedulePage.tsx** is the largest file. It contains the full calendar grid, drag-to-move (HTML5 + touch), resize handles, pinch-to-zoom, day/week views, appointment CRUD, auto-arrange by route, day map modal, and external calendar overlay.
- Appointment chips use absolute positioning calculated from `SLOT_HEIGHT_PX` (48px) and `SLOT_MINUTES` (15min). Day range: 7:30 AM - 8:00 PM.
- Touch interactions: hold-to-drag (200ms), hold-to-resize (300ms), hold-to-add (400ms). Uses refs + global event listeners for move/end tracking.
- Stores export from `src/stores/index.ts`. Seven stores: patient, appointment, sync, recurringBlock, calendarEvent, schedule, theme.
- CSS uses custom properties (`--color-*`) for theming (light/dark/system). Theme store in `themeStore.ts`.
- Google Sign-In via GIS (accounts.google.com/gsi/client). Auth state in `src/api/auth.ts`.

## Working Rules
- **Check existing code first.** Before creating a new file or utility, check if something similar already exists in `src/utils/`, `src/components/ui/`, or `src/api/`. Extend existing code over creating duplicates.
- **Verify after changes.** Run `npm run build` after any non-trivial edit to catch TypeScript and build errors early. Don't stack multiple changes without verifying.
- **Don't create or restructure files without asking.** Add to existing files when possible. Only create new files when clearly necessary for the task.
- **Save corrections immediately.** When the user corrects a preference, style, or approach, write it to MEMORY.md right away. Don't wait to be asked.

## Session Startup
1. Read `HANDOFF.md` for what was last worked on
2. Run `git log --oneline -5` and `git diff --stat` to see any changes made since the last handoff (other models or manual edits won't update HANDOFF.md, but Git catches everything)
