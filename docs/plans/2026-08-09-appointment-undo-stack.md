# Multi-Step Undo for Appointment Chips

## Context

Accidentally deleting a chip or dragging one to the wrong slot is currently unrecoverable. Two partial, inconsistent undo mechanisms exist today:

- `src/hooks/usePendingDelete.ts` — a 5s *deferred commit* for single deletes. "Undo" just cancels a timer; once committed, gone forever.
- `useWeekActions.handleUndoClearWeek` — a real field-snapshot undo, but only for Clear Week, desktop-only, and `window.confirm`-gated.

Goal: replace both with one multi-step undo stack covering every appointment-chip gesture plus the two bulk operations, surfaced through a single touch-reachable control.

**Confirmed decisions:** appointment chips + Clear Week + Auto-Arrange. 20-deep stack, **no redo**. Toast + persistent pill (one collapsing component). In-memory only, does not survive reload. Patient-level chip notes covered via `patientStore`. Recurring sibling edits batched as one entry.

## Keystone finding

`src/hooks/useSync.ts` has **zero** `useAppointmentStore` references and writes appointments through 8 direct Dexie calls. It consumes the delete tombstone at `useSync.ts:166`.

Therefore: **recording inside the store structurally excludes every sync-driven write.** No filtering heuristics, no "is this a user action?" guesswork. This is what makes the whole design tractable and it dictates the architecture below.

Second confirmed fact: every single-chip gesture is already exactly **one** store call (drag and resize keep in-flight state in refs and commit once on release). Only Clear Week, Auto-Arrange, recurring-sibling edits, and OCR import are multi-call.

---

## Architecture

Record inside `src/stores/appointmentStore.ts` and `src/stores/patientStore.ts`, with an opt-out:

```ts
export interface MutationOptions { record?: boolean }   // default true
create(appt, opts?)  update(id, changes, opts?)  delete(id, opts?)  putOnHold(id, opts?)
```

All params optional → **no existing call site breaks**.

Rejected alternatives:
- *Explicit `pushUndo()` at each gesture site* — needs 7 new blocks in `SchedulePage.tsx`, which CLAUDE.md forbids growing.
- *A `useUndoableAppointments()` wrapper hook* — makes *not recording* the default, so future gestures silently lose undo. Also can't see store-internal calls (`putOnHold` calls `get().update()` at `appointmentStore.ts:305`).

Layering avoids a cycle: `appointmentStore → undoStore` one-way. The applier that needs both lives in `undoApply.ts`.

History lives in its **own** store — `SchedulePage.tsx:164` subscribes with no selector, so adding state to `appointmentStore` would re-render the whole 2488-line page on every push.

---

## New files

| Path | Purpose | ~LOC |
|---|---|---|
| `src/stores/undoStore.ts` | Entry types, Zustand stack, `recordUndo` / batch / `runWithoutUndo` / id-remap. Imports nothing from appointmentStore. | 170 |
| `src/stores/undoApply.ts` | Pop-and-apply loop, staleness checks, remap registration. React-free → unit-testable. | 160 |
| `src/hooks/useUndoStack.ts` | Toast/pill state machine + `undo()`. Called **only** by `UndoSurface`. | 85 |
| `src/utils/mutationCooldown.ts` | `markLocalMutation()` / `isInMutationCooldown(ms)` — extracted from SchedulePage's page-local ref so undo can stamp it too. | 12 |
| + 4 test files | see Testing | ~580 |

**Modified:** `appointmentStore.ts` (+55), `patientStore.ts` (+25), `useWeekActions.ts` (**−90 net**), `AppointmentDetailModal.tsx` (+6), `ScanPage.tsx` (+2), `UndoDeleteToast.tsx` (rewritten, +40), `SchedulePage.tsx` (**net negative** — wiring and deletions only).

**Deleted:** `src/hooks/usePendingDelete.ts` (111 LOC), `ClearedWeekSnapshot` types + `handleUndoClearWeek` in `useWeekActions.ts`, the Clear-Week undo pill at `SchedulePage.tsx:1557-1566`.

---

## `UndoEntry` type

```ts
// src/stores/undoStore.ts
import type { Appointment, Patient } from "../types";

/** calendarEventId deliberately omitted — see "Tombstone policy". */
export type AppointmentSeed = Omit<Appointment, "id" | "createdAt" | "updatedAt" | "calendarEventId">;
export type AppointmentPatch = Partial<Omit<Appointment, "id" | "createdAt">>;
export type PatientPatch = Partial<Omit<Patient, "id" | "createdAt">>;

interface UndoEntryBase {
    entryId: string;   // uuid v4
    at: number;        // Date.now()
    label: string;     // toast text, e.g. "Appointment moved"
}

export interface UndoUpdateEntry extends UndoEntryBase {
    kind: "update";
    reason: "move" | "resize" | "note" | "detail";
    appointmentId: string;
    before: AppointmentPatch;   // only keys the caller actually changed
    after: AppointmentPatch;    // same keys post-change — for conflict detection
}
export interface UndoPatientEntry extends UndoEntryBase {
    kind: "patient"; patientId: string; before: PatientPatch; after: PatientPatch;
}
export interface UndoHoldEntry extends UndoEntryBase {
    kind: "hold"; appointmentId: string; previousStatus: Appointment["status"];
}
export interface UndoCreateEntry extends UndoEntryBase {
    kind: "create"; appointmentId: string;
}
export interface UndoDeleteEntry extends UndoEntryBase {
    kind: "delete";
    appointmentId: string;          // the destroyed uuid — drives remapping
    snapshot: AppointmentSeed;
    calendarEventId?: string;       // diagnostics only; never reused
}
export interface UndoBatchEntry extends UndoEntryBase {
    kind: "batch";
    source: "clear-week" | "auto-arrange" | "recurring-edit" | "multi";
    children: UndoPrimitiveEntry[];  // applied newest-first
}

export type UndoPrimitiveEntry =
    | UndoUpdateEntry | UndoPatientEntry | UndoHoldEntry | UndoCreateEntry | UndoDeleteEntry;
export type UndoEntry = UndoPrimitiveEntry | UndoBatchEntry;
```

Store API:

```ts
export const UNDO_STACK_LIMIT = 20;
interface UndoState { entries: UndoEntry[]; idRemap: Record<string, string>; }
interface UndoActions {
    push: (e: UndoEntry) => void;              // trims to last 20
    pop: () => UndoEntry | undefined;
    registerRemap: (oldId: string, newId: string) => void;
    clearHistory: () => void;
}
export const useUndoStore = create<UndoState & UndoActions>(/* … */);

// Non-hook module API, used by the stores and useWeekActions:
export function recordUndo(entry: Omit<UndoEntry, "entryId" | "at">): void;
export function runWithoutUndo<T>(fn: () => Promise<T>): Promise<T>;
export function beginUndoBatch(source: UndoBatchEntry["source"], label: string): void;
export function endUndoBatch(): void;
export function abortUndoBatch(): void;
export function resolveUndoId(id: string): string;   // follows remap chain, depth-capped 20, visited-set cycle guard
```

---

## Recording detail

**`update`** — `previous` is already captured at `appointmentStore.ts:205` for the error-rollback path; reuse it.
- `before` = pick from `previous` only the keys present in `changes`; `after` = `changes`.
- **No-op suppression:** if every key in `after` equals its value in `before`, record nothing. This is what keeps Auto-Arrange (which has no change-detection at `useWeekActions.ts:134`) from filling a batch with meaningless entries.
- `reason` inferred: `date|startTime` → `move`; else `duration` → `resize`; else `chipNote|chipNotes|chipNoteColor|notes` → `note`; else `detail`.
- Record **after** `appointmentDB.update` resolves (`:221`) — `update` swallows errors rather than throwing, so recording earlier would record a rolled-back change.
- `previous` undefined → record nothing.

**`create`** — record after store state updates (`:189`), using the returned id.

**`delete`** — `:250` already does `appointmentDB.get(id)`; snapshot from that, strip `id`/`createdAt`/`updatedAt`/`calendarEventId`, record after `appointmentDB.delete` succeeds (`:258`).

**`putOnHold`** — capture `appointmentBefore.status`, call inner `update(id, {...}, { record: false })`, record exactly one `hold` entry. Prevents a double-record.

**`patientStore.update` (`:129`)** — produces `UndoPatientEntry`, but it differs from the appointment store in two ways that matter:
- It fetches `existing = await patientDB.get(id)` at `:132` — that *is* the pre-change snapshot, use it. But it also derives `finalChanges` at `:145-148`, which **nulls out `lat`/`lng`** whenever `address` changed without explicit coords. So `before` must be keyed off **`finalChanges`, not `changes`** — otherwise undoing an address edit restores the address but leaves the geocode wiped, silently re-triggering a geocode pass.
- Unlike `appointmentStore.update`, it **rethrows** (`:164`). So record after `patientDB.update` resolves; no need for the swallowed-error dance.

`SchedulePage.tsx:1000-1018` (`handlePatientChipNote`) writes to both stores, so wrap that pair in `beginUndoBatch("multi", "Note updated")` / `endUndoBatch()` so it undoes as **one** entry. That is +2 lines in SchedulePage — the only additive edit to that file in the whole plan, and it's offset many times over by the deletions.

**Labels** are generated at record time inside the store, derived from `kind` + `reason` (a small `labelFor(entry)` helper in `undoStore.ts`), so call sites never pass display strings. Batch labels are the exception — they carry a count and are passed to `beginUndoBatch`.

**Opt-outs:** `ScanPage.tsx:509` OCR bulk-import loop → wrap in `runWithoutUndo`.

---

## Batching

Module-level `openBatch` with refcounting (nested begins ignored; only the outermost closes). `recordUndo` appends to `openBatch.children` when open, else pushes.

`endUndoBatch()`:
1. **Dedupe by target id, keeping the FIRST child** — Clear Week's outer retry loop (`useWeekActions.ts:213`) can issue up to 2N deletes; the first snapshot is the original state.
2. Zero children → push nothing (no empty toast).
3. Else push one `UndoBatchEntry`.

`abortUndoBatch()` discards; call it in every `catch`.

**Retrofit sites:**
- `handleAutoArrangeDay` — begin before the loop at `:126`, end after it (before `:143`), abort in the `catch` at `:146`.
- `handleClearWeek` — begin before the retry loop at `:213`, end after `:222`, abort in the `catch` at `:237`. Keep the `window.confirm`.
- `AppointmentDetailModal.tsx` — wrap the sibling loops at `:199` and `:655`.

Then **delete** from `useWeekActions.ts`: `ClearedWeekAppointmentSnapshot` (`:14-27`), `ClearedWeekSnapshot` (`:29-33`), `lastClearedWeekSnapshot` state (`:57`), `handleUndoClearWeek` (`:246-302`), and the two interface members. Its recreate-with-new-uuid logic **moves into `undoApply.ts`** as the shared delete-undo path — it is already the correct algorithm, including `syncStatus: "local"`.

---

## The hard problem: undo-delete mints a new uuid

The original uuid is gone, the Google event was really deleted, and a tombstone was written. Undo-delete is a **re-create**, exactly as `handleUndoClearWeek` does today.

**Stale ids → id-remap map, not pruning.** A monotonic `Record<oldId, newId>` consulted at apply time. Pruning would silently destroy correct history: *move A → delete A → undo (A′ appears) → undo again* should slide A′ back to its old slot, and remap makes that work. The map is ~15 lines precisely **because there is no redo** — nothing walks it backwards. Registration happens in exactly two places, both in `undoApply.ts`. Pruning remains the *fallback* for genuinely-vanished rows.

**Tombstone policy — deliberate deviation, verified.** Do **not** call `clearDeletedAppointmentId(oldId)` on undo:
- On the happy path there is nothing to clear — `appointmentStore.ts:272` already clears it when the Google delete succeeds.
- The tombstone only survives when the Google delete **failed or was queued** (`:277`, `:281`), meaning the event may still exist in Google under the old id. `useSync.ts:166` uses the tombstone to skip re-importing it.
- Our re-created appointment has a new uuid and **no `calendarEventId`**, so it pushes to Google as a fresh event. The tombstone on `oldId` blocks nothing about it.
- Clearing it would let the next pull re-import the ghost under `oldId` → **a duplicate chip beside the undone one.**

Omitting `calendarEventId` from the seed and keeping the tombstone are a matched pair. This matches current `handleUndoClearWeek` behavior.

**`deletingIds`/`mutatingIds` (3s windows in `loadByRange`):** the fresh uuid was never in `deletingIds`, so that window is structurally sidestepped — a second reason new-uuid re-create is right. **Must pass `syncStatus: "local"`** on re-create (as `useWeekActions.ts:278` does): `loadByRange`'s merge at `:109` only preserves `pending | local | mutating`.

**Undo must never record itself** — the applier passes `{ record: false }` explicitly on every store call. **Do not also use a global `runWithoutUndo` suppression counter around the applier**: applies are async, so a counter held across `await` boundaries would silently swallow a legitimate concurrent user gesture. The explicit flag is precise and sufficient. `runWithoutUndo` is kept only for the genuinely synchronous-intent bulk case (`ScanPage`'s OCR import), where suppressing everything in the window is the desired behavior.

**Undo must set the sync cooldown.** `SchedulePage.tsx:209` ignores sync-triggered reloads for 3s after `mutationCooldownRef` is stamped (set at `:818` after a drag, `:1051` before a delete). Undo writes go through the store but **not** through those two sites, so a sync pull landing within 3s of an undo could clobber the restored state — reintroducing exactly the bug that ref exists to prevent. Fix: extract the ref into `src/utils/mutationCooldown.ts` (~12 LOC, `markLocalMutation()` / `isInMutationCooldown(ms)`), have `undoApply` call `markLocalMutation()` before its store calls, and swap SchedulePage's 4 ref usages (`:140`, `:209`, `:818`, `:1051`) for the imports. LOC-neutral in SchedulePage, and it makes the cooldown reusable rather than page-local.

**Sync changed it underneath:**
- *Row gone* → `resolveUndoId`, then check `appointments` / `onHoldAppointments` / `appointmentDB.get`. Missing → stale; drop and try the next entry, bounded by `UNDO_STACK_LIMIT`. `kind: "delete"` entries are exempt (they create something new).
- *Field changed* → apply a **partial patch of only the recorded `before` keys** so sync-written fields survive. Per key, compare current against the recorded `after`; if they differ, someone else changed it → skip that key. All keys skipped → treat as stale, continue. (~10 lines, `computeRevertPatch`.) This makes undo conflict-safe rather than last-writer-wins.

**Batch undos loop sequentially with `await`**, never `Promise.all` — preserves sync-queue ordering.

---

## UI: one collapsing surface

Rewrite `src/components/ui/UndoDeleteToast.tsx` as a single fixed-position element with two states. **One mount point** (replacing `SchedulePage.tsx:2298`), rendering on mobile where the `hidden sm:flex` header buttons don't.

**It takes no props and subscribes to `useUndoStore` itself:** `<UndoSurface />`.

This is load-bearing, not stylistic. `SchedulePage.tsx:164` subscribes with no selector, so calling `useUndoStack()` inside SchedulePage would re-render the entire 2488-line page on every stack push *and* every toast timer transition. Keeping the subscription inside the leaf component confines those re-renders to ~40 lines of JSX. `useUndoStack` is therefore called **only** by `UndoSurface`, never by SchedulePage.

Consequently `deleteWithSync` cannot be a hook return value. It becomes a plain exported module function in `src/stores/undoApply.ts`:

```ts
export async function deleteAppointmentWithSync(id: string): Promise<void>;
// = markLocalMutation(); await useAppointmentStore.getState().delete(id);
//   window.dispatchEvent(new Event("pt-scheduler:request-sync"));
```
SchedulePage imports and calls it directly — no subscription, no re-render coupling.

- **Expanded (6s after any recorded action):** existing styling and position — `fixed bottom-40 sm:bottom-24 left-1/2 -translate-x-1/2 z-50`, `role="status" aria-live="polite"`, plus `aria-atomic="true"` so the whole line re-announces on swap. Does not collide with the FAB at `bottom-24 sm:bottom-6 right-6`.
- **Collapsed (timer expired, `depth > 0`):** shrinks to a compact icon+count pill in the same position — Lucide `RotateCcw`, `aria-label={`Undo (${depth} available)`}`. Tapping it re-expands and undoes.
- **`depth === 0`:** renders nothing.

**Messages** from the entry `label`: "Appointment deleted" · "Appointment moved" · "Duration changed" · "Note updated" · "Appointment added" · "Moved to On Hold" · "Cleared 14 appointments" · "Day auto-arranged" · "Edited 12 recurring events".

**Rapid stacking:** one surface only. Each new entry swaps the message to the newest and **resets** the 6s timer.

**Chaining:** clicking Undo pops-and-applies, then stays expanded showing the *next* label with a fresh 6s timer. Depth > 1 → `detail` reads `"3 more"`. Empty → "Nothing left to undo", no button, 3s, then unmount. The collapsed pill is what makes deep entries reachable after the window lapses.

---

## Retiring `usePendingDelete`

**Replace, don't layer** — layering guarantees two competing toasts, and the 5s deferred commit is redundant once real undo exists. All changes are one-line swaps or deletions in `SchedulePage.tsx`:

| Line | Now | After |
|---|---|---|
| 168 | `usePendingDelete()` destructure | **delete the line** — SchedulePage takes no undo subscription |
| 272 | `&& apt.id !== pendingDeleteId` | remove term + dep |
| 304 | `if (appointment.id === pendingDeleteId) continue;` | remove line + dep |
| 388 | `lastClearedWeekSnapshot, handleUndoClearWeek` | remove from destructure |
| 1051-1052 | `mutationCooldownRef.current = Date.now();` + `queuePendingDelete(appointment)` | `void deleteAppointmentWithSync(appointment.id)` (it stamps the cooldown itself) |
| 1557-1566 | Clear-Week undo pill | delete |
| 2298 | `<UndoDeleteToast visible=… onUndo=… />` | `<UndoSurface />` — no props |
| 2429-2434 | `queuePendingDelete` / else-branch | collapse both to `await deleteAppointmentWithSync(appointmentId)` |

Also swap the 4 `mutationCooldownRef` usages (`:140`, `:209`, `:818`, `:1051`) for `markLocalMutation()` / `isInMutationCooldown(3000)` imports.

**Accepted behavior change:** deletion is now immediate rather than deferred 5s, so the Google event dies even if undo follows a second later, and undo re-creates a new event. Inherent to real undo, already true of Clear Week, and it removes the commit-on-unmount race.

---

## Testing

Harness exists: `src/test/setup.ts` imports `fake-indexeddb/auto`, jsdom via `vitest.config.ts`.

**`src/stores/undoStore.test.ts`** (no mocks) — 21 pushes → 20 kept, oldest dropped; `runWithoutUndo` suppresses nested records *and* restores the counter when the callback **throws**; batch of 3 → one entry with 3 children, children absent individually; batch dedupe keeps the **first** snapshot for a repeated id; empty batch pushes nothing; `abortUndoBatch` discards; `resolveUndoId` A→B→C resolves to C, self-cycle A→A terminates, depth cap holds.

**`src/stores/undoApply.test.ts`** — real Dexie + fake-indexeddb, mock only the Google layer:
```ts
vi.mock("../api/calendar", () => ({ deleteCalendarEvent: vi.fn(), createCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn() }));
vi.mock("../api/auth", () => ({ isSignedIn: vi.fn(() => false) }));
vi.mock("./syncStore", () => ({ useSyncStore: { getState: () => ({ calendarId: "", refreshPendingCount: vi.fn() }) } }));
```
`beforeEach`: clear `db.appointments`/`db.calendarEvents`/`db.syncQueue`, `localStorage.clear()`, reset both stores. Assert:
1. Undo `update` restores exactly the `before` keys; an unrelated field written meanwhile is untouched.
2. A reverted field changed by someone else post-recording → that key skipped; all keys skipped → entry dropped, **next** entry applied.
3. Undo `create` deletes it.
4. Undo `delete` creates with a **different id**, identical `patientId/date/startTime/duration/visitType/chipNotes`, `syncStatus === "local"`, **`calendarEventId === undefined`**.
5. **Remap:** update A → delete A → undo (→A′) → undo again → A′ has A's pre-move slot.
6. **Tombstone:** `isSignedIn()` true, `calendarId` set, `deleteCalendarEvent` rejects; delete then undo → `getDeletedAppointmentIds().has(oldId) === true`, exactly one appointment in the slot.
7. Undo `hold` returns it to `appointments` with `previousStatus`.
8. Undo `batch("clear-week")` re-creates all N with new ids in date/time order; stack does not grow.
9. Undo `batch("auto-arrange")` restores every original `startTime`.
10. Stale entry (row deleted straight from Dexie *and* state) → dropped, next applied, never throws.
11. Empty stack → `{ status: "empty" }`.
12. Applying an undo records nothing — length decreases by exactly 1.
13. Two concurrent `applyNextUndo()` calls do not apply the same entry twice.
14. Every apply path calls `markLocalMutation()` before its store writes (spy on the util).
15. A user gesture recorded *during* an in-flight undo apply still lands on the stack — guards against reintroducing a global suppression counter.

**`src/stores/patientStore.test.ts`** (extend) — undoing an address change restores `address` **and** `lat`/`lng` (the `finalChanges` nulling at `:145-148`); a rethrown error records nothing.

**`src/stores/appointmentStore.test.ts`** (extend) — ⚠️ the existing `vi.mock("../db/operations")` factory at `:10-24` **omits `trackDeletedAppointmentId` / `clearDeletedAppointmentId`**, which the store already imports; add them as `vi.fn()` before any delete-path test. Then: no-op patch records nothing; `{ record: false }` records nothing; `putOnHold` records exactly one `hold` entry; existing assertions still pass.

**`src/hooks/useUndoStack.test.ts`** — `renderHook` + `vi.useFakeTimers()`, mock `../stores/undoApply`. Empty → nothing rendered; push → expanded with label; second push resets timer and swaps message; at 6s → collapses to pill (not hidden) while depth > 0; Undo click → `applyNextUndo` once, re-expands with next label and fresh timer; empty result → "Nothing left to undo", no button; rapid double-click → invoked once.

**Re-render guard** — in `src/pages/pages.test.tsx`, render SchedulePage with a render counter and assert that pushing an undo entry does **not** re-render it. This is the only automated defense against someone later "simplifying" `UndoSurface` back into a props-driven component.

**`src/components/ui/UndoDeleteToast.test.tsx`** — expanded renders message + detail; button fires handler; `onUndo` omitted → no button; `depth === 0` → renders nothing; collapsed pill has the right `aria-label`; `role="status"` / `aria-live="polite"` present.

---

## Execution order

Each phase ends with `npm run build` **and** `npx vitest run` green before moving on.

- **Phase 0** — Baseline: run build + full suite, record the current pass/fail set so later regressions are attributable.
- **Phase 1** — `undoStore.ts` + its tests, **and** the pure extraction of `mutationCooldown.ts` (swap SchedulePage's 4 ref usages). Nothing wired; zero behavior change — the cooldown extraction should be provably a no-op.
- **Phase 2** — Instrument `appointmentStore.ts` and `patientStore.ts` (mind the `finalChanges` lat/lng rule and the rethrow); `runWithoutUndo` in `ScanPage.tsx`; extend `appointmentStore.test.ts` (fix the mock factory first) and `patientStore.test.ts`. *Verify in devtools that a sync pull adds zero entries* — this is the keystone assumption.
- **Phase 3** — `undoApply.ts` + its tests. Still unwired.
- **Phase 4** — `useUndoStack.ts` + the `UndoSurface` rewrite + both test files.
- **Phase 5** — SchedulePage wiring per the table above; wrap `handlePatientChipNote` in a `"multi"` batch; delete `usePendingDelete.ts`. (Between Phases 2 and 5, patient chip notes transiently produce two stack entries instead of one — harmless, and closed here.) **Manual smoke:** drag a chip → toast → Undo → returns; delete → Undo → returns (confirm new uuid in devtools); 5 gestures → chain-tap Undo 5× → LIFO revert; let the toast lapse → pill remains → tap it → undoes; set a patient chip note → Undo → **both** halves revert.
- **Phase 6** — Bulk batching: begin/end/abort in `handleAutoArrangeDay`, `handleClearWeek`, and the `AppointmentDetailModal` sibling loops. Delete `handleUndoClearWeek`, the snapshot types, and the header pill. **Manual:** Clear Week → one toast "Cleared N appointments" → Undo restores all N; Auto-Arrange an already-optimal day → **no toast** (no-op suppression working); edit a recurring event → one entry, not N.
- **Phase 7 (optional)** — Fold the duplicate ad-hoc `autoArrangeError` toast (`SchedulePage.tsx:2292-2296`, identical classes) into the shared component with `onUndo` omitted.

Then the CLAUDE.md deploy sequence: `npm run build` → commit → push → `vercel --prod`.

---

## Verification

- `cd pt-scheduler && npm run build` — must be clean (strict TS, no `any`, no unused vars).
- `npx vitest run` — full suite plus the ~560 lines of new tests.
- `npm run dev` and walk the Phase 5 / Phase 6 manual smoke lists above on a narrow viewport (mobile is the primary target — portrait PWA).
- Devtools check with a configured Google Calendar: delete → undo → confirm **one** chip, not two, and that a subsequent sync pull doesn't resurrect a ghost.

## Design audit

The plan was re-checked against the source after drafting. Four defects were found and are already fixed above; recorded here so they don't get re-introduced.

| # | Defect | Fix |
|---|---|---|
| 1 | `useUndoStack()` called in SchedulePage would re-render the 2488-line page on every push and every toast tick — the exact problem that forced history into its own store. | `<UndoSurface />` subscribes internally; `deleteAppointmentWithSync` is a module function, not a hook return. Guarded by a render-count test. |
| 2 | Undo writes bypassed `mutationCooldownRef` (`SchedulePage.tsx:209`), so a sync pull within 3s could clobber restored state. | Extract `mutationCooldown.ts`; `undoApply` stamps it. |
| 3 | Recording patient `before` from `changes` would miss the `lat`/`lng` nulling at `patientStore.ts:145-148`, so undoing an address edit would silently leave the geocode wiped. | Key `before` off `finalChanges`. |
| 4 | A global `runWithoutUndo` counter held across the applier's `await`s would swallow concurrent user gestures. | Rely on explicit `{ record: false }`; keep `runWithoutUndo` only for the synchronous-intent OCR import. |

Verified sound, no change needed: sync's store-bypass (0 references, 8 direct Dexie writes); 1-call-per-gesture for drag/resize; `appointmentStore.update` swallowing errors (dictates record-after-resolve); the `deletingIds` sidestep via fresh uuid; every SchedulePage line reference in the wiring table.

Residual risk accepted: `openBatch` is module-global, so a gesture committed *during* a long Clear Week would be absorbed into that batch. `weekActionInProgress` gates the UI during those loops, so this is unreachable in practice — but it is the same class of bug as #4 and worth remembering if that gate is ever removed.

## Known limitations

1. **The Google event is genuinely destroyed and re-created.** Calendar sharers see delete-then-create; external references to the old event id break. Unavoidable given `appointmentStore.ts:269` deletes immediately.
2. **`restoreFromHold` is outside the wrapper** — it bypasses `update()` (`appointmentStore.ts:328`). Sidebar restores aren't undoable, and put-on-hold → restore-from-Sidebar leaves a dead `hold` entry. Handled by treating an `undefined` return as stale-drop-and-continue.
3. **The tombstone policy** should be re-verified against a live configured calendar before Phase 5 ships — the reasoning depends on how `appointmentId` is derived from Google event metadata upstream of `useSync.ts:262`.
4. **Undoing a large Clear Week fires N sequential `create()` calls**, each flipping `loading: true` (`appointmentStore.ts:167`). `handleUndoClearWeek` has this today; `loadByRange`'s skeleton only appears when `appointments.length === 0`, so expect a spinner not a skeleton — needs a manual check on a 40-appointment week in Phase 6.
