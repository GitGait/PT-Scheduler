# PT Scheduler - Project Context

## What This Is
Home health physical therapy scheduling PWA. Built and running. Currently in active UI/UX polish phase.

## Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Framework | React 19 + Vite |
| State | Zustand (7 stores) |
| Database | Dexie.js (IndexedDB), offline-first |
| Styling | Tailwind CSS + CSS custom properties (`--color-*`) |
| Maps | Leaflet |
| Icons | Lucide React |
| Dates | date-fns |
| IDs | uuid v4 |
| Validation | Zod |
| APIs | Google Calendar, Sheets, Auth (GIS), Distance Matrix, OCR |
| Testing | Vitest + @testing-library/react |
| Deploy | Vercel |
| PWA | vite-plugin-pwa |
| Package Manager | npm |

## Commands
```bash
cd pt-scheduler
npm run dev          # Dev server
npm run build        # tsc + vite build (use to verify changes)
npm test             # Vitest (single run)
npm run test:watch   # Vitest in watch mode
npm run test:coverage # Vitest with coverage
npx tsc --noEmit     # Type-check only (no output)
vercel --prod        # Deploy to production
```

Single-file test: `npm test -- src/utils/matching.test.ts`

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
| **Main schedule calendar** | `pt-scheduler/src/pages/SchedulePage.tsx` (~2800 lines) |
| Types (Patient, Appointment, VisitType) | `pt-scheduler/src/types/index.ts` |
| Database schema + operations | `pt-scheduler/src/db/schema.ts`, `operations.ts` |
| Zustand stores (7 total) | `pt-scheduler/src/stores/` |
| API layer (auth, calendar, sheets, OCR, geocode, distance) | `pt-scheduler/src/api/` |
| Patient matching (3-stage) | `pt-scheduler/src/utils/matching.ts` |
| Validation schemas (Zod) | `pt-scheduler/src/utils/validation.ts` |
| App shell + routing | `pt-scheduler/src/App.tsx` |
| Global styles + CSS vars | `pt-scheduler/src/index.css` |
| UI components | `pt-scheduler/src/components/ui/` |
| Pages | `pt-scheduler/src/pages/` (Schedule, Patients, PatientDetail, Scan, Route, Settings) |
| Phase specs (reference only) | `phases/Phase_*.md` |

## Architecture Patterns
- **SchedulePage.tsx** is the largest file. Contains the full calendar grid, drag-to-move (HTML5 + touch), resize handles, pinch-to-zoom, day/week views, appointment CRUD, auto-arrange by route, day map modal, and external calendar overlay.
- Appointment chips use absolute positioning from `SLOT_HEIGHT_PX` (48px) and `SLOT_MINUTES` (15min). Day range: 7:30 AM - 8:00 PM.
- Touch interactions: hold-to-drag (200ms), hold-to-resize (300ms), hold-to-add (400ms). Uses refs + global event listeners.
- Stores export from `src/stores/index.ts`. Seven stores: patient, appointment, sync, recurringBlock, calendarEvent, schedule, theme.
- CSS uses custom properties (`--color-*`) for theming (light/dark/system). Theme store in `themeStore.ts`.
- Google Sign-In via GIS. Auth state in `src/api/auth.ts`.
- Offline-first: all data in IndexedDB via Dexie.js, synced to Google when online.
- Sync queue in `src/hooks/syncQueue.ts` handles retry with exponential backoff.

## Conventions
- Zod schemas in `validation.ts` are the single source of truth for API types. Derive types with `z.infer<typeof schema>`.
- Functional React components with hooks only — no class components.
- Add to existing Zustand stores before creating new ones.
- Use existing CSS custom properties for theming, not new color values.
- Database operations go through `src/db/operations.ts` helpers.
- Patient matching uses 3-tier confidence: auto (>=90%), confirm (>=70%), manual (<70%).
- Test files live next to source files as `*.test.ts` or `*.test.tsx`.
- Mock external APIs in tests — never call real APIs.
- See `.claude/rules/` for full code-style, architecture, and testing details.

## Do NOT
- Use `any` types or leave unused variables.
- Add more code to `SchedulePage.tsx` — extract new features into separate components.
- Access Dexie directly — use `src/db/operations.ts` helpers.
- Create new files or restructure without asking — extend existing files when possible.
- Create new stores when an existing store can be extended.
- Call real Google APIs in tests — always mock.
- Skip `npm run build` verification after non-trivial changes.
- Stack multiple changes without verifying the build.

## Working Rules
- **Check existing code first.** Before creating a new file or utility, check `src/utils/`, `src/components/ui/`, or `src/api/`. Extend existing code over creating duplicates.
- **Verify after changes.** Run `npm run build` after any non-trivial edit to catch errors early.
- **Save corrections immediately.** When the user corrects a preference, style, or approach, write it to MEMORY.md right away.

## Context Rules
- **Session startup:** Read `HANDOFF.md` first, then `git log --oneline -5` and `git diff --stat` to catch changes from other models or manual edits.
- **Don't bulk-read docs.** The `phases/` specs are reference only — read specific sections when needed, not entire files.
- **Use HANDOFF.md for context transfer.** Update it at the end of a session with what was done, what's next, and any gotchas.
- **Detailed rules live in `.claude/rules/`.** Check `architecture.md`, `code-style.md`, and `testing.md` for full conventions — don't duplicate them here.
