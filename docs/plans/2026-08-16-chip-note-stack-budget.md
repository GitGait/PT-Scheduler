# Fix: budget the whole chip note banner stack, not just profile lines

## Context

A code review of `18214c3..HEAD` (the chip profile-note commits) found that
`AppointmentChipNotes.tsx` budgets profile-note banner rows from chip height
**alone**, ignoring the quick-note banners that share the same stack.

The banner stack is `absolute bottom-0` inside an `overflow-hidden` chip, so it
grows **upward** — when the stack outgrows the chip, the rows clipped are the
ones at the **top**, i.e. the user-authored quick notes. Two consequences:

1. **The content column slides under the banners.** The padding reserve
   (`chipProfileNoteExtraReservePx`) counts profile lines only, so with any
   quick note present the profile rows get no reserve at all. Triggers on an
   everyday combination: a 30-min chip (94px), one quick note, a two-line
   patient note → 3 banner rows (~52px) over a column that reserves ~29px.
2. **Quick notes get clipped.** A 15-min chip (46px) with 4 quick notes renders
   ~69px of banners today — the top notes are cut off. Reachable now:
   `MAX_CHIP_NOTES = 4` and 15-min visits are common.

**Intended outcome:** the banner stack can never outgrow the chip, quick notes
(user-authored, higher value) always outrank profile lines, anything that
doesn't fit is surfaced via a `+N` counter and the hover tooltip rather than
being silently clipped, and the padding reserve matches what is actually
rendered.

### Two findings from design review that changed the approach

- **Capping only profile lines does not fix (2).** Quick notes are rendered
  uncapped, so the stack must be budgeted *as a whole*, quick notes included —
  with a floor of one row so a short chip is never silent.
- **The padding reserve is weaker than it looks.** `overflow: hidden` clips at
  the *padding box*, and the column is top-anchored, so extra `padding-bottom`
  does not push content up — it only shrinks the content box (~2.5px of
  flex-shrink slack per row). **The row budget is the real fix; the reserve is
  secondary.** This is an argument for getting the budget right and for not
  over-padding.

### Decisions taken (confirmed with the user)

- **`CHIP_CONTENT_MIN_PX = 40`** — guarantees the patient name in both views and
  name+time in week view. Chosen over 48 because 48 costs a profile line on the
  most common case (30-min chip + 1 quick note drops 2 lines → 1). At 40 there
  are **zero regressions for 0–1 quick notes**.
- **`+N` counter** on the last visible quick-note banner when notes are dropped,
  rather than silent omission.
- **Do not cap `resolveDisplayNotes` at `MAX_CHIP_NOTES`.** The row budget makes
  the render safe for any count, and keeping it uncapped keeps the tooltip
  complete. The uncapped write paths are a separate follow-up (below).

## Out of scope

- Review finding #3 (the `AppointmentDetailModal` preview caption over-promising
  what the chip will show) — cosmetic, and gating it correctly would duplicate
  the chip's height logic in the modal.
- Capping `chipNotes` at the write path (`ScanPage.tsx:556-559`,
  `useSync.ts:291-300` both append/parse without a cap). Worth a follow-up
  issue; not needed for correctness once the budget lands.

## Files

| File | Change |
|---|---|
| `pt-scheduler/src/components/appointments/AppointmentChipNotes.tsx` | The whole change (constants, budget, shared layout pass, render, tooltip) |
| `pt-scheduler/src/pages/SchedulePage.tsx` | **2 lines**: import name at `:33`, call at `:1884`. Padding expression at `:1937-1939` unchanged. No new code added (per CLAUDE.md) |
| `pt-scheduler/src/components/appointments/AppointmentChipNotes.test.tsx` | 3 existing tests updated, new blocks added |

Reuse as-is (no new utilities): `meaningfulNoteLines` / `MAX_PROFILE_NOTE_LINES`
from `src/utils/chipNoteText.ts`, `getChipNoteClasses` from
`src/utils/chipNoteColors.ts`, geometry from `src/utils/scheduling.ts`.

## Implementation

### 1. Constants (`AppointmentChipNotes.tsx`)

Keep `PROFILE_NOTE_MIN_HEIGHT_PX = 60` and `PROFILE_NOTE_EXTRA_LINE_PX = 30`.
Replace `PROFILE_NOTE_ROW_PX = 17` with:

```ts
// Rendered height of one banner row: 10px text at leading-tight (12.5px) +
// py-0.5 (4px) + a 1px top border = 17.5px. Rounded up so the reserve never
// under-pads.
const CHIP_NOTE_ROW_PX = 18;
// Chip height the banner stack may never eat into, so the content column's
// identity rows survive: week view is 4px pad + 16px name + 2px gap + 14px
// time = 36px; day view is 8 + 20 = 28px for the name alone. 40 clears both.
const CHIP_CONTENT_MIN_PX = 40;
```

### 2. Row budget

```ts
/**
 * Banner rows the whole stack may use. The stack is bottom-anchored inside an
 * overflow-hidden chip, so anything past this budget would be clipped off the
 * TOP of the stack — i.e. the user's own quick notes. Budget it instead.
 */
function bannerRowBudget(heightPx: number): number {
    return Math.max(0, Math.floor((heightPx - CHIP_CONTENT_MIN_PX) / CHIP_NOTE_ROW_PX));
}
```

Budgets: 46px → 0, 76px → 2, 94px → 3, 142px → 5, 190px → 8.

`allowedProfileNoteLines(heightPx)` stays exactly as it is (the height-based
cap). `visibleProfileNoteLines` gains a `rowsLeft` parameter and takes
`Math.min(allowedProfileNoteLines(heightPx), Math.max(0, rowsLeft))`. **Dedup
still runs against the full quick-note list, not the visible subset**, so a
budgeted-out quick note doesn't cause its duplicate profile line to reappear.

### 3. One shared layout pass

Add a private `chipNoteStack(appointment, patient, heightPx)` returning
`{ allQuickNotes, quickNotes, profileLines, reservePx }`, so the padding reserve
and the rendered banners can never disagree:

```ts
const allQuickNotes = resolveDisplayNotes(appointment, patient);
const budget = bannerRowBudget(heightPx);
// Floor of 1: a 15-min chip has no budget, but dropping the only quick note
// is worse than the overlap. Quick notes are user-authored; profile lines yield.
const quickNotes = allQuickNotes.length > 0
    ? allQuickNotes.slice(0, Math.max(1, Math.min(allQuickNotes.length, budget)))
    : [];
const profileLines = visibleProfileNoteLines(
    patient, heightPx, allQuickNotes, budget - quickNotes.length
);
const reservePx = Math.max(0, quickNotes.length + profileLines.length - 1) * CHIP_NOTE_ROW_PX;
```

`resolveDisplayNotes` is unchanged.

### 4. Rename the export

`chipProfileNoteExtraReservePx` → **`chipNoteStackReservePx`** (it now counts the
whole stack, not just profile rows). Thin wrapper over `chipNoteStack(...).reservePx`.
Update the doc comment: the reserve covers banner rows past the first, quick
notes and profile lines alike; the chip's base 12/14px padding still nominally
covers row one.

No clamp on the reserve is needed — the budget is the clamp. Worst case at 94px
is `(3-1) × 18 = 36`, giving `12 + 36 = 48px` bottom padding on a 94px column
(42px content box, ≥ the 28px day-view name block).

### 5. Render + `+N` counter

The component destructures `chipNoteStack(...)` and renders `quickNotes` then
`profileLines`. The quick-note banner becomes a two-span row so the count
survives `truncate` (the count span must be `shrink-0`; row height is identical
— same text size, padding, border, so no arithmetic changes):

```tsx
{quickNotes.map((note, idx) => {
    const hidden = allQuickNotes.length - quickNotes.length;
    const showCount = hidden > 0 && idx === quickNotes.length - 1;
    return (
        <div
            key={note + idx}
            className={`${cc.bg} ${cc.text} text-[10px] font-semibold px-1.5 py-0.5 leading-tight border-t ${cc.border} first:border-t-0 flex items-center gap-1`}
        >
            <span className="truncate">{note}</span>
            {showCount && <span className="shrink-0 opacity-80">+{hidden}</span>}
        </div>
    );
})}
```

The profile-line banner markup is unchanged. The early return becomes
`if (quickNotes.length === 0 && profileLines.length === 0) return null;`.

### 6. Tooltip must carry what the budget dropped — required, not optional

Today's tooltip only appends `patient.notes` when `profileLines.length > 0`. With
a budget in play, profile notes that lost their rows would vanish entirely.
Change to everything the chip knows:

```tsx
const tooltip = [...allQuickNotes, ...meaningfulNoteLines(patient?.notes, Infinity)]
    .filter(Boolean)
    .join("\n");
```

(`meaningfulNoteLines(..., Infinity)` yields the same string as the old raw
`patient.notes` for well-formed notes, and additionally strips boilerplate.)

### 7. `SchedulePage.tsx` — rename only

- `:33` — import `chipNoteStackReservePx` instead of `chipProfileNoteExtraReservePx`.
- `:1884` — `const noteReservePx = chipNoteStackReservePx(appointment, patient, heightPx);`
- `:1937-1939` padding expression **unchanged**.

## Expected behavior change

Reference: `q` = quick notes, cells are profile lines shown (old → new).

| height | q=0 | q=1 | q=2 | q=3 | q=4 |
|---|---|---|---|---|---|
| 46 (15m) | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| 76 | 1→1 | 1→1 | 1→**0** | 1→**0** | 1→**0** |
| 94 (30m) | 2→2 | 2→2 | 2→**1** | 2→**0** | 2→**0** |
| 142 (45m) | 3→3 | 3→3 | 3→3 | 3→**2** | 3→**1** |
| 190 (60m) | 3→3 | 3→3 | 3→3 | 3→3 | 3→3 |

Quick notes deferred to `+N`/tooltip: `46: q≥2`, `76: q≥3`, `94: q≥4`. In every
one of those cells today's stack already overflows the chip or fully buries the
name row. **After the fix the stack never overflows at any height or note count.**

## Tests

### Existing tests to update (exactly three, plus the import)

1. Import + `describe` at `:159` and its 3 call sites → `chipNoteStackReservePx`.
2. `:166` *"reserves one row for a second visible line"* — `.toBe(17)` → **`.toBe(18)`**.
3. `:188` *"renders quick notes first and the profile note lines last, in order"* —
   at `TALL` (94) the budget is 3, so 2 quick notes leave room for only 1 profile
   line and the 4-element assertion fails. **Change the render height to `TALLER`**
   (budget 5) and keep the 4-row expectation — it is an ordering test, not a
   budget test.

All other existing tests pass unchanged (verified by hand against the new
arithmetic, including the 15-min quick-note case, both dedup tests, the legacy
`chipNote` merge, and the color-selection tests).

### New cases

Match the existing fixture style: `TALL=94`, `TALLER=142`, `MEDIUM=76`,
`SHORT=46`, `makePatient` / `makeAppointment` / `renderNotes`, `afterEach(cleanup)`.

`describe("banner row budget")`
- drops a profile line when quick notes take the chip's rows (`TALL`, 2 quick, 2-line note → line 1 shown, line 2 absent)
- **keeps a 30-min chip's second profile line with only one quick note** (`TALL`, 1 quick, 2-line note → both shown) — sentinel: fails if `CHIP_CONTENT_MIN_PX` is ever raised past 40
- no profile lines when quick notes fill the budget (`TALL`, 3 quick → both profile lines absent, all 3 quick notes shown)
- still shows the profile line on a 76px chip with one quick note
- never renders more rows than the chip can hold (`TALL`, 6 quick → 3 children)
- always shows one quick note on a 15-min chip, even with four (`SHORT` → 1 child, text `"a"`)
- drops profile lines before quick notes (`SHORT`, 2 quick + profile note → only the first quick note)
- **property test**: `[SHORT, MEDIUM, TALL, TALLER, 190] × [0,1,2,3,4,6]` → assert `rows * 18 <= h || rows === 1`

`describe("overflow counter")`
- shows `+3` on the only banner of a 15-min chip with 4 quick notes
- no counter when every quick note fits
- the counter sits on the **last** visible quick note, not the profile lines

`describe("chipNoteStackReservePx")` (additions)
- counts quick notes in the reserve (`TALL`, 1 quick + 1-line note → **18**)
- counts the whole stack (`TALL`, 1 quick + 2-line note → **36**)
- caps at what the chip can carry (`TALL`, 4 quick, no note → **36** not 54; assert `12 + result <= TALL - 20`)
- reserves nothing when only one banner fits (`SHORT`, 4 quick → **0**)
- six-row stack on a 60-min chip (`190`, 3 quick + 3-line note → **90**)

`describe("tooltip")` (additions)
- keeps the profile note in the tooltip when no profile line fits (`TALL`, 3 quick → `title` contains the note)
- lists quick notes the chip had no room to render (`SHORT`, 3 quick → `title === "a\nb\nc"`)
- keeps boilerplate out of the tooltip (guards the `meaningfulNoteLines` swap)

## Verification

From `pt-scheduler/`:

```powershell
npx vitest run src/components/appointments/AppointmentChipNotes.test.tsx
npx tsc --noEmit
npm test
npm run build
```

Then visually, via `npm run dev` — the arithmetic is the point, so check it on
real chips:

1. A patient with a 3-line profile note plus 1 quick note, booked at **30 min**
   in week view: both profile lines still show and the name/time are not covered.
2. Same patient at **15 min** with 4 quick notes: exactly one banner with `+3`,
   nothing clipped at the top of the stack, hover shows all four notes.
3. Same at **45** and **60 min**: stack grows, still no overlap of the name row.
4. Repeat 1–2 in **day view** (larger text, 14px base padding).
5. Live-resize a chip from 15 → 60 min and back: banners should add/remove rows
   cleanly, since `heightPx` uses the resize preview duration.

Then follow the CLAUDE.md deploy sequence (build → commit → push → `vercel --prod`).

## Follow-ups (not this change)

- Cap `chipNotes` at `MAX_CHIP_NOTES` on the write path (`ScanPage.tsx:556-559`,
  `useSync.ts:291-300`) — the invariant belongs there, not in the renderer.
- Optionally gate the `AppointmentDetailModal` preview caption (`:580`) on the
  same height/dedup logic, or soften "Chip shows:" → "Chip may show:".
