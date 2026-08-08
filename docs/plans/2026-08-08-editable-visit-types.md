# User-editable visit types (codes, labels, colors)

## Context

Visit types are frozen at compile time today. `VISIT_TYPE_CODES` (`src/types/index.ts:53-56`) is a
12-entry `as const` union, and `VISIT_TYPE_CONFIGS` (`src/utils/visitTypeColors.ts:17-91`) hardcodes
each label plus a hand-picked hex color and gradient. There is no UI to change any of it.

The user wants to add codes (e.g. `PT26`) with their own description and color, and recolor/rename the
existing ones — from Settings, without breaking the OCR image-scan import that auto-assigns visit
types. They use the app mostly on an iPhone, so the config **must** sync between devices.

### Decisions made with the user

1. **Unknown scanned code** (a `PT26` scanned before it's configured): keep the code on the
   appointment, render it in the default gray, and surface it in Settings as an "unconfigured type
   found" row with a one-tap Add. Never drop to null; never auto-create.
2. **Persistence: Google Sheets.** Device-local storage would not reach the iPhone. A new "Visit Types"
   tab in the existing spreadsheet, synced via the existing queue + reconciler. The OAuth scope
   (`.../auth/spreadsheets`, `src/api/auth.ts:7-10`) already covers it — no new sign-in or setup.
3. **Built-ins** can be renamed, recolored, and hidden from the dropdown, but **not deleted** —
   `PT18`/`PT19` drive auto-discharge (`useAutoDischarge.ts:44`) and `NOMNC` drives scan routing
   (`ScanPage.tsx:483-487`). User-created types are deletable.
4. **The OCR prompt receives the user's code list** to improve accuracy, with a clean fallback to
   today's behavior when absent.

---

## A. Type widening

`VisitType` becomes `string | null`. Half-measures don't help: `string | BuiltInCode | null` collapses
to `string | null` in TS anyway. `VISIT_TYPE_CODES` has only three importers, so the ripple is small.

In `src/types/index.ts:53-56`:
- `BUILT_IN_VISIT_TYPE_CODES` — the same 12 strings `as const` (renamed from `VISIT_TYPE_CODES`).
- `BuiltInVisitTypeCode = typeof BUILT_IN_VISIT_TYPE_CODES[number]` — kept, so literal comparisons
  still typo-check.
- `VisitType = string | null`. Delete `VisitTypeCode`.

| File | Change |
|---|---|
| `src/pages/ScanPage.tsx:9-10, 536-545` | Drop both imports and the `as VisitTypeCode` cast; replace the gate (§F). |
| `src/hooks/useSync.ts:28, 716-721` | Drop the import; `parseVisitType` becomes a shape check (§F). |
| `src/db/schema.ts:3, 231` | **Freeze**: replace the import with a local literal `MIGRATION_V2_VALID_VISIT_TYPES` set. The v2 migration reconstructs 2024-era data; if it tracked user config, the same DB upgrade would produce different results on two devices. Comment it as historical and immutable. |
| `src/hooks/useAutoDischarge.ts:44` | Compiles unchanged, but hoist to `const DISCHARGE_CODES: BuiltInVisitTypeCode[] = ["PT18","PT19"]` so a typo stays a build error. Same for `"NOMNC"` in ScanPage. |

## B. Registry — CSS custom properties, not React state

The binding constraint: `SchedulePage.tsx:1878` calls `getVisitTypeGradient()` inside render for every
chip, must repaint when a color changes, and **must not gain a line** (CLAUDE.md). Confirmed at
`:1876-1878` and `:1915` that the result lands in an inline `style` prop, so a `var()` string works
there verbatim.

Accessors return `var(--vt-grad-PT11, <compile-time built-in gradient>)`. A provider injects a
`<style>` block. This solves three problems at once: repaint is the browser's job (no subscription in
SchedulePage), the call signature is unchanged (no SchedulePage edit), and the `var()` **fallback is
the current built-in gradient baked into the bundle**, so the first paint before Dexie hydrates is
pixel-identical to today — no flash of gray.

**`src/utils/visitTypeColors.ts` (rewrite, ~same size):**
- `BUILT_IN_VISIT_TYPE_CONFIGS: readonly VisitTypeConfig[]` — the existing 12, frozen, keeping their
  curated gradient strings.
- Export `DEFAULT_VISIT_TYPE_CONFIG` separately and **remove it from the array**. This kills the
  positional `VISIT_TYPE_CONFIGS[length-1]` dependency at `VisitTypeSelect.tsx:15`.
- Replace the module-load `colorMap` (`:93-96`) with `let registry`, `setVisitTypeRegistry(configs)`,
  and `subscribeVisitTypes(fn)` over a listener `Set` — a ready-made `useSyncExternalStore` pair.
- `cssVarNameForCode(code)` → `--vt-grad-PT11` / `--vt-grad--none`.
- `getVisitTypeGradient` / `getVisitTypeColor` return `var(...)` with the built-in as fallback.
  `getVisitTypeLabel` / `getVisitTypeConfig` read `registry` directly (text can't be a CSS var; neither
  has a SchedulePage caller).
- `deriveGradient(bg)` — darken ~18% in RGB, `linear-gradient(135deg, …)`. Used only for user-chosen
  colors; a built-in whose `bg` is unchanged keeps its curated pair.
- `buildVisitTypeCssText(configs)` → the `:root { … }` string.

**`src/components/VisitTypeStyleProvider.tsx` (new, ~30 lines):**
`useSyncExternalStore(subscribeVisitTypes, getVisitTypeCssText)` → `<style>{css}</style>`, plus a mount
effect calling the store's `loadAll()`. Keeps the whole feature self-contained.

**`src/App.tsx`:** one line — `<VisitTypeStyleProvider />` inside `<ErrorBoundary>`.

**`useVisitTypes()`** — a small hook exported from `visitTypeColors.ts`, also built on
`useSyncExternalStore(subscribeVisitTypes, …)`, returning the effective config list. This is what
`VisitTypeSelect` and the Settings card consume for **labels and list membership** (which CSS vars
can't carry). SchedulePage never uses it.

**Rename note:** `VISIT_TYPE_CONFIGS` ceases to exist as a static export. Its only importer is
`VisitTypeSelect.tsx:4`, which switches to `useVisitTypes()`.

**Invalid-color failure mode (must not be skipped).** If a custom property resolves to a malformed
value, `background: var(--vt-grad-PT26, …)` becomes *invalid at computed-value time* — CSS then applies
`unset`, **not** the `var()` fallback, so the chip renders transparent rather than gray. The `var()`
fallback only protects the *undefined* case. Therefore `buildVisitTypeCssText` must emit only values it
has re-validated against `/^#[0-9a-f]{6}$/i`, and `parseVisitTypeRow` must never pass a raw sheet cell
through to the registry (a hand-edited sheet is an untrusted input). Covered by a test below.

## C. Data model — sparse overrides over frozen built-ins

```ts
export interface VisitTypeDef {
  code: string;        // PRIMARY KEY, immutable, /^[A-Z][A-Z0-9]{1,9}$/
  label: string;
  bg: string;          // "#rrggbb"
  hidden: boolean;     // hidden from the dropdown only; still colors existing chips
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
```

- **No stored `gradient`** — derived (see §B), no drift.
- **No stored `isBuiltIn`** — it's `BUILT_IN_VISIT_TYPE_CODES.includes(code)`, a compile-time fact. A
  column is written to the Sheet for human readability but **ignored on parse**, so a hand-edited sheet
  can't make `PT18` deletable.
- **Dexie stores only overrides and custom types — built-ins are never seeded.** Effective registry =
  `BUILT_IN_CONFIGS.map(b => overrides.get(b.code) ?? b).concat(customs)`. Consequences: "recolored" vs
  "untouched" is just row-exists-or-not; "Reset to default" is a row delete; a fresh device is correct
  with zero network; and the built-in 12 are **structurally unremovable** by any code path.
- **`code` is immutable after creation.** Appointments reference it by string, Google Calendar private
  metadata (`ptSchedulerVisitType`) holds it on remote events, and the OCR path writes
  `"Visit Type: PT26"` into notes. A rename would orphan history on every device. Custom types offer
  delete-and-re-add; the card's help text says so.
- **Dexie:** add `visitTypes!: EntityTable<VisitTypeDef, "code">` and
  `this.version(13).stores({ …all of v12 verbatim…, visitTypes: "code" })`. No `.upgrade()` needed.
- **`src/db/operations.ts`:** add `visitTypeDB` beside `dayNoteDB` — `all/get/put/delete/bulkPut` plus
  `distinctAppointmentVisitTypes()` via `db.appointments.orderBy("visitType").uniqueKeys()`
  (`visitType` is an index, so this reads keys only). Nothing outside `operations.ts` touches the table.

## D. The Sheets tab

Tab `"Visit Types"`, headers `["code","label","color","hidden","sortOrder","isBuiltIn","updatedAt"]`
→ range `Visit Types!A:G`. Parse `hidden` case-insensitively and accept `1`/`0`/`yes` (USER_ENTERED
coerces). `updatedAt` is written for humans only — **not** used for conflict resolution, matching every
other entity here (remote-wins-unless-pending).

**Missing-tab wipe hazard.** `fetchDayNoteSheetRows(..., false)` returns `[]` on 400/404, and `[]` makes
the reconciler delete every tracked row — for a config table that would wipe the user's setup on all
devices. Three layers:
1. `fetchVisitTypesFromSheet` returns `VisitTypeDef[] | null`, where `null` means *absent/unreadable*.
   Call `getSheetIdByTitle(id, token, "Visit Types", false)` first — metadata, not an inferred 400. Then
   read; if that returns `[]` too (rename race), still return `null`.
2. `null` short-circuits in `useSync` before the reconciler runs. Zero deletes.
3. Built-ins are immune by construction (§C) — worst case loses customizations, never codes.

Keep the day-note-style tracked-code set in localStorage
(`ptScheduler.sheetVisitTypeCodes.<spreadsheetId>`) so a genuinely deleted custom type propagates.

**First run:** tab absent, Dexie empty, nothing pushed — correct, since device 2 also has the built-ins
compiled in. The tab is created lazily by the first `upsertVisitTypeToSheet`. Recolor PT11 on desktop →
1 Dexie row + 1 queue item → tab created with headers → the iPhone's next `runFastSync` pulls it. Also
add a manual **"Push my visit types to the sheet"** button in Settings, mirroring `handleImportPatients`
(`SettingsPage.tsx:264-314`), as an escape hatch.

## E. Sync wiring

**`src/api/sheets.ts`** — new section after the Day Notes block (~`:1159`), copying that trio:
- `VISIT_TYPES_SHEET_TITLE`, `DEFAULT_VISIT_TYPE_HEADERS`.
- `parseVisitTypeRow` / `buildVisitTypeRowForHeaders` — exported for tests, pure.
- Refactor `ensurePatientSheetHeaders` (`:699-748`, the smart variant that diffs and **appends missing
  columns**) into `ensureSheetHeaders(spreadsheetId, token, sheetTitle, defaultHeaders)` and have both
  patients and visit types call it. Net-negative lines. Do **not** copy the dumb day-note variant.
  *Risk note:* this is the only step that modifies a **working** sync path. If the patient-import
  manual check (verification step 3's patient equivalent) regresses, drop the refactor and give visit
  types their own copy of the smart body — the feature does not depend on the shared helper.
- `fetchVisitTypesFromSheet` (§D), `upsertVisitTypeToSheet` (structural copy of `:1044-1115`, matching
  on `code`), `deleteVisitTypesFromSheetByCodes` (delegates to the already-generic
  `deletePatientSheetRows`).
- Pass an **explicit** range to `fetchPatientSheetRows` — a bare tab title defaults to the patient
  column width.

**`src/db/visitTypeSheetSync.ts` (new, ~110 lines)** — modeled on `dayNoteSheetSync.ts`, no network I/O.
`reconcileVisitTypesFromSheetSnapshot(spreadsheetId, sheetTypes)` → `{upserted, deleted}`. Remote wins
via `visitTypeDB.put` except codes with a non-`synced` queue item; deletion driven by the tracked-code
set. **Guard:** never `put` a code failing the format regex.

**`src/hooks/useSync.ts`** — five mechanical insertions:
1. Imports (~`:20-30`); drop `VISIT_TYPE_CODES`.
2. `export const VISIT_TYPES_SYNCED_EVENT = "pt-scheduler:visit-types-synced"` (~`:60`).
3. `syncVisitTypesFromSheets` right after `syncDayNotesFromSheets` (`:99-110`) — no cooldown, **bails on
   `null`**, dispatches the event and calls the store's `loadAll()` on change.
4. One call after `await syncDayNotesFromSheets();` in `runFullSync` (`:559`) and `runFastSync`
   (`:585`); add to the dep array (`:628`). This inherits all five existing triggers free: mount,
   2-min interval, window focus, visibilitychange, and the forced `pt-scheduler:request-sync`.
5. `case "visitType":` in the queue handler after the `dayNote` case (`:903-916`).

**`src/types/index.ts`:** `SyncEntity` (`:119`) += `"visitType"`; add `SyncQueueDataVisitType` to the
discriminated union (`:162-167`). Verified there are exactly four `dayNote` touchpoints in the whole
repo (`types/index.ts:119,166`, `stores/dayNoteStore.ts:30`, `useSync.ts:903`) — SettingsPage's Sync
Queue card does **not** switch on entity, so nothing else needs a case.

**`src/stores/visitTypeStore.ts` (new)** — owns the built-in/override merge, calls
`setVisitTypeRegistry`, and carries `enqueueVisitTypeSync` copied from `dayNoteStore.ts:21-34`.
*Note on the "don't create new stores" rule:* none of the six existing stores is a plausible home
(syncStore is hand-rolled config, themeStore is `persist`, the rest are per-entity). Flagging this as a
deliberate exception, consistent with `dayNoteStore`.

## F. Scan path (decision #1)

Replace the gate at `ScanPage.tsx:536-545`:
```ts
const validVisitType: VisitType = isPlausibleVisitTypeCode(visitType) ? visitType : null;
```
where `isPlausibleVisitTypeCode(v)` is `!!v && /^[A-Z][A-Z0-9]{1,9}$/.test(v)`.

**The shape guard is load-bearing.** `normalizeVisitType` falls through to `cleaned.toUpperCase()` at
`:71`, so a garbage OCR read like `"SMITH, JOHN"` in the visitType field is today silently swallowed by
the whitelist. Removing the whitelist without a replacement would land that garbage on the appointment
and in the "unconfigured types" list. The regex admits `PT26`/`OT01`/`NOMNC`/`EVAL` and rejects prose.

**Consolidate normalization** into `src/utils/visitTypeCodes.ts` (new): `normalizeVisitType`,
`VISIT_TYPE_PREFIX_REGEX`, `parseVisitTypeAndName`, `isPlausibleVisitTypeCode`,
`validateNewVisitTypeCode`. Delete the near-duplicate at `scheduling.ts:166-198` (verified unused, and
it silently omits NOMNC). `schema.ts`'s migration copy stays frozen and separate (§A).

**`useSync.ts:716-721`** — `parseVisitType` becomes the same shape check. This closes the Calendar
round-trip: a `PT26` appointment created on the iPhone currently gets **nulled out** when the desktop
pulls it from Google Calendar.

**Unconfigured codes must survive the dropdown — a data-loss bug decision #1 introduces.**
`VisitTypeSelect.tsx:15` does `VISIT_TYPE_CONFIGS.find(c => c.code === value) ?? <fallback>`. Once a
`PT26` appointment can exist without a `PT26` config, opening its detail modal would display **"None"**,
and saving would silently erase the code. Fix in the same edit that makes the list dynamic: when `value`
is non-null and absent from the registry, synthesize a transient option `{ code: value, label:
"Unconfigured", bg: DEFAULT.bg }`, select it, and render it at the top of the list with a distinct pill
so the value round-trips untouched. Regression test named below.

**"Unconfigured types found"** in Settings sources from `distinctAppointmentVisitTypes()` diffed against
the registry (including hidden codes), each rendered with an occurrence count and an **Add** button that
pre-fills the form. Recompute on card mount and on the synced events.

## G. OCR prompt injection (decision #4)

1. `src/utils/validation.ts:141` — extend `ocrRequestSchema` with
   `visitTypeCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/)).max(60).optional()`. Verified
   `api/_validation.ts` only re-exports this file, so **the server needs no edit**.
2. `src/api/ocr.ts` — `processScreenshot(image, targetWeekStart, visitTypeCodes?)`, included in the body
   only when non-empty; `processScreenshotFile` forwards. ScanPage passes visible codes plus hidden
   built-ins (hidden means "not in my dropdown", not "never in my schedule"), sorted and deduped.
3. `api/_prompts.ts:47` — `buildOCRPrompt(targetWeekStart, visitTypeCodes?)`. When present, append one
   block after the existing rules listing the codes and saying: prefer an exact match when ambiguous
   (`"PTI1"` → `"PT11"`), but **do not force** — emit a clearly-different code verbatim. That last
   clause preserves the unconfigured-code path.
4. `api/ocr.ts:38` — pass `body.visitTypeCodes`.
5. **Fallback:** the param is optional; absent, the prompt is byte-identical to today's, so a
   service-worker-cached old client keeps working.

## H. Settings UI

New: `src/components/settings/VisitTypeSettingsCard.tsx` and `VisitTypeEditorRow.tsx`.
`SettingsPage.tsx` gains exactly one `<VisitTypeSettingsCard />` between the Patient Import and Calendar
Sync cards (~`:560`), preserving its flat `<Card>` + `<CardHeader>` structure.

**Color control: both.** A row of ~14 preset swatches (the 12 built-in `bg` values plus two neutrals)
for one-tap use on iPhone, and a native `<input type="color">` for anything else — good on iOS Safari,
no dependency. Store lowercased `#rrggbb`.

**Rows:** built-ins get a "Built-in" pill, editable label and color, an eye/eye-off hide toggle, and a
trailing **Reset** (disabled with no override) — no delete. Custom types get a "Custom" pill and a
**Delete** with inline confirm ("Delete PT26? Appointments keep the code and render gray."). Hidden rows
render at 60% opacity with a footnote that they still color existing chips.

**Validation** (in `visitTypeCodes.ts`, shared with the sheet parser): auto-uppercase as typed; must
match `/^[A-Z][A-Z0-9]{1,9}$/` — the leading letter keeps it a valid CSS custom-property suffix and
avoids colliding with the `--vt-grad--none` sentinel. Reject duplicates **including hidden and built-in
codes**, with distinct copy: *"PT18 is a built-in type. It's currently hidden — unhide it instead."*
(with an Unhide button) versus *"PT26 already exists."* Silently shadowing a hidden built-in is the
subtle bug to avoid. Label required, ≤40 chars. Color must match `/^#[0-9a-f]{6}$/i`.

Every mutation: store → `visitTypeDB` → `setVisitTypeRegistry` (instant repaint) → `enqueueVisitTypeSync`.
Works offline; the queue drains later.

## I. Protecting auto-discharge and NOMNC routing

Both compare **codes**, never labels, so renaming and recoloring are pure presentation and cannot affect
them. Hiding `PT18` is also harmless — hiding only filters `VisitTypeSelect`'s options, while
auto-discharge reads `appointment.visitType`. Because built-ins live in a frozen compile-time constant
and Dexie holds only overrides, there is **no code path that can remove them** — not a UI bug, not a
corrupted sheet row, not a Dexie wipe. Add a comment above `BUILT_IN_VISIT_TYPE_CONFIGS`: *"PT18/PT19
drive auto-discharge and NOMNC drives scan routing. Codes are behavioural contracts — never remove."*

---

## Files

**New (7):** `src/utils/visitTypeCodes.ts` · `src/stores/visitTypeStore.ts` ·
`src/db/visitTypeSheetSync.ts` · `src/components/VisitTypeStyleProvider.tsx` ·
`src/components/settings/VisitTypeSettingsCard.tsx` · `src/components/settings/VisitTypeEditorRow.tsx`
· plus test files below.

**Modified (13):** `src/types/index.ts` · `src/utils/visitTypeColors.ts` · `src/db/schema.ts` ·
`src/db/operations.ts` · `src/api/sheets.ts` · `src/hooks/useSync.ts` · `src/pages/ScanPage.tsx` ·
`src/utils/scheduling.ts` (delete dead duplicate) · `src/components/ui/VisitTypeSelect.tsx` ·
`src/pages/SettingsPage.tsx` · `src/App.tsx` · `src/api/ocr.ts` + `src/utils/validation.ts` ·
`api/_prompts.ts` + `api/ocr.ts`.

**`src/pages/SchedulePage.tsx`: zero changes. `api/_validation.ts`: zero changes.**

## Verification

**Tests** (Vitest, `globals: false` → import `afterEach` + `cleanup` locally; type `vi.fn()` props as
`Mock<…>`; never call real Google APIs):

- **`src/api/sheets.test.ts` (extend)** — pure, no mocks, matching that file's convention: parse/build
  round-trip; permuted header order still parses via `findHeaderIndex`; blank code → `null`; `pt26` →
  uppercased; `"PT 26"` → rejected; `hidden` from `"TRUE"`/`"true"`/`"1"`/`""`; an `isBuiltIn` cell of
  `"FALSE"` on `PT18` is ignored; invalid color `"red"` falls back rather than storing raw.
- **`src/utils/visitTypeCodes.test.ts` (new)** — `normalizeVisitType` on `"[PT 11]"`,
  `"Visit Type: PT11"`, `"pt-11"`, `"NOMNC"`, `"RE EVAL"`, regression-locking what ScanPage depends on;
  `isPlausibleVisitTypeCode` accepts `PT26`/`OT1`/`NOMNC`, rejects `""`/`"SMITH, JOHN"`/`"12"`;
  `validateNewVisitTypeCode` against a hidden `PT18` returns the built-in-hidden variant.
- **`src/utils/visitTypeColors.test.ts` (new)** — `getVisitTypeGradient("PT11")` before hydration
  contains the exact current gradient as the `var()` fallback (**guards the no-flash requirement**);
  after `setVisitTypeRegistry`, `buildVisitTypeCssText()` contains `--vt-grad-PT11`; unknown `"PT26"`
  falls back to gray (decision #1); `deriveGradient` yields a valid two-stop gradient; an unchanged
  built-in keeps its curated gradient; **`buildVisitTypeCssText` omits (rather than emits) any entry
  whose `bg` fails hex validation**, so a corrupt value degrades to the built-in fallback instead of
  rendering a transparent chip.
- **`src/db/visitTypeSheetSync.test.ts` (new, fake-indexeddb)** — custom `PT26` upserted; a code with a
  pending queue item is not overwritten; a tracked custom code absent from the snapshot is deleted; a
  tracked *built-in override* absent from the snapshot deletes the row and the effective registry falls
  back to the frozen built-in; a malformed code `"!!!"` is skipped.
- **`src/components/ui/VisitTypeSelect.test.tsx` (new — none exists)** — renders customs, omits hidden,
  always includes "None" regardless of registry length (**regression test for the removed `[length-1]`
  assumption**); arrow-key nav lands correctly now the array is dynamic; and **`value="PT26"` with an
  empty registry displays `PT26`, not "None", and `onChange` is never called with `null` on open/close
  (the data-loss regression).**
- **`useAutoDischarge`** — a recolored, relabelled, hidden `PT18` still triggers auto-discharge.

Known pre-existing failure, do not chase: `src/db/operations.test.ts > geocodeCacheDB > should put and
get an entry by addressKey`.

**Manual:**
1. `npm run build` clean (NOT `npx tsc --noEmit` — the root tsconfig doesn't cover `src/`); `npm test` green.
2. Fresh profile: schedule renders in today's exact colors, no gray flash, no `visitTypes` rows in Dexie.
3. Recolor PT11 → chips repaint immediately without navigating; a Dexie row + queue item appear; queue
   drains; the "Visit Types" tab is created with headers.
4. Add `PT26`, assign it → chip shows the chosen color and `[PT26]`.
5. Hide `PT00` → gone from the dropdown; an existing PT00 appointment still renders purple.
6. `PT18` offers Reset, never Delete.
7. **Scan a `PT26` row before configuring it** (clean profile): the appointment keeps `PT26`, renders
   gray, and appears under "Unconfigured types found" with a working one-tap Add.
8. Scan with `PT26` configured: confirm `visitTypeCodes` is in the `/api/ocr` body and scan quality is
   unchanged or better.
9. **Two-device:** desktop recolors PT11 + adds PT26 → queue drains → background/foreground the iPhone
   PWA (fires `visibilitychange` → `runFastSync`) → PT11 repaints and PT26 is in the dropdown within one
   cycle. Then delete PT26 on the iPhone and confirm it clears on the desktop after a focus event.
10. **Wipe-hazard drill:** rename the sheet tab to "Visit Types2", force a sync on both devices —
    nothing may be deleted locally, one handled warning in the console. Rename back, confirm resume.
11. **Offline drill:** airplane mode → edit a color → persists and repaints → reconnect → queue drains.

## Phasing

Each phase ends with a green `npm run build` **and** `npm test`.

- **0 — Extract, no behavior change.** `visitTypeCodes.ts` from ScanPage's copy; delete the dead
  `scheduling.ts` duplicate; add its test. *App identical.*
- **1 — Type widening.** `VisitType = string | null`, `BUILT_IN_VISIT_TYPE_CODES`, frozen migration set,
  hoisted `DISCHARGE_CODES`/`NOMNC_CODE`. Gates still in place. *Zero runtime change.*
- **2 — Registry + CSS vars.** Rewrite `visitTypeColors.ts`, add the provider and `useVisitTypes()`,
  one App line, and switch `VisitTypeSelect` from the deleted `VISIT_TYPE_CONFIGS` to the hook, fixing
  its positional-null bug. *Visually identical; nothing hydrates yet.* (`VisitTypeSelect` is touched
  again in phase 4 to filter hidden types — it can't do that until the store exists.)
- **3 — Storage.** `VisitTypeDef`, Dexie v13, `visitTypeDB`, `visitTypeStore`. *Colors editable
  programmatically; no UI, no sync.*
- **4 — Settings UI.** Card, row, validation. **Shippable checkpoint — fully usable on one device.**
- **5 — Sync.** Union members, sheets.ts trio + shared `ensureSheetHeaders`, `visitTypeSheetSync.ts`,
  useSync's five insertions, the enqueue helper. Run drills 9 and 10 here.
- **6 — Scan path.** Replace the ScanPage gate and `parseVisitType`; add the unconfigured-codes section.
- **7 — OCR prompt.** Schema field, client body, `buildOCRPrompt` param. Deploy `/api`, re-verify scanning.

Phases 6–7 are last on purpose: they touch data ingestion, the highest-risk path, and by then the
"unconfigured types found" UI exists before any unconfigured code can be created.

**Deploy** per CLAUDE.md, all four steps: `npm run build` → `git add -A && git commit` →
`git push origin main` → `cd pt-scheduler && vercel --prod`.

## Out of scope

- Renaming a code after creation, and any appointment-rewrite migration to follow it.
- Drag-to-reorder (`sortOrder` is written but only orders built-ins-then-custom).
- Per-visit-type default duration, billing rules, or icons.
- Bulk reassignment ("change all PT26 to PT11").
- `updatedAt` conflict resolution — remote-wins-unless-pending, matching every other entity here.
- Editing the "Unspecified" (null) default color.
- Personal event categories (`personalEventColors.ts`) — same shape, deliberately untouched.
- Migrating historical `"Visit Type: PT26"` note strings into the `visitType` field.
