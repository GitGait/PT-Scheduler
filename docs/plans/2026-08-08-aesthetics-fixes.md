# PT Scheduler — Aesthetics Fixes (light-mode scope)

## Context

An aesthetics audit (`docs/2026-08-08-aesthetics-audit.md`) found 28 issues. The user does not use dark mode, which removes the largest cluster (Tailwind `darkMode` wiring, orphaned `@media (prefers-color-scheme)` blocks, day-note theme resolution, `theme-color` meta) and deflates the semantic-token work to cosmetic-only. The user also chose to skip touch-target work and defer the WCAG compliance cluster (modal focus traps, dialog roles, reduced-motion).

What remains is the work that is felt in daily light-mode use on a phone:

1. **Appointment chip text is unreadable on light visit-type colors** — hardcoded white text measures 1.90:1 on Amber `#ffab00` and 1.86:1 on Cyan `#26c6da` (WCAG AA needs 4.5:1). Chips carry patient name, visit type, facility and address, read one-handed in a car in daylight. This is the highest-value fix in the audit and is entirely light-mode-relevant.
2. **Mobile navigation is top-mounted and icon-only** — `BottomNav.tsx` is fully implemented, correct, and never imported. Mobile users tap icon-only pills at the top of the screen.
3. **Dead affordances and a font that never loads** — Search/Help have no handlers; the `Google Sans` webfont is proprietary and 404s, so the app silently renders in Roboto while paying for a render-blocking request.

Outcome: chips legible at every palette color, thumb-reachable mobile nav, no non-functional chrome.

---

## Phase 1 — Chip contrast (highest value, self-contained)

### The insight that makes this small

`SchedulePage.tsx:1908` applies `text-white` as a **single class on the chip root**; every content row (`:1942`, `:1947`, `:1953`, `:1960`, `:1971`, `:1998`, and `AppointmentChipContacts.tsx:36`) inherits it and only varies `opacity`. It sits directly beside an inline `background: chipGradient` at `:1919`. So replacing one class with one computed inline `color` fixes every row at once.

Two color paths exist and must both be handled:
- **Visit types** — user-editable; hex lives in `buildVisitTypeCssText` and reaches chips as `var(--vt-grad-CODE)`. The accessors return *CSS var expressions*, not hex, so luminance math cannot run at the chip site. Foreground must be emitted as a CSS custom property where the real hex is available.
- **Personal events** — `personalEventColors.ts:81` `getPersonalCategoryGradient` returns a literal gradient string from a hardcoded array, bypassing the CSS-var system entirely. Needs a parallel literal-hex accessor.

### Steps

**1.1 — Add color math to `src/utils/visitTypeColors.ts`** (alongside `darkenHex` at `:116-126`, not a new file — per CLAUDE.md "extend existing files")

- Extract the inline hex parsing from `darkenHex` into a shared `parseHex(hex): [r,g,b]` and reuse it in `darkenHex`. **Do not re-tune `darkenHex`'s math** — `visitTypeColors.test.ts:69-79` pins its exact 0.18 output (`#039be5` → `#027fbc`).
- Add `relativeLuminance(hex: string): number` — standard WCAG sRGB linearization.
- Add `readableForeground(hex: string): string` — returns `#ffffff` when luminance ≤ ~0.179, else `darkenHex(hex, 0.82)`.

  Using a darkened version of the chip's *own hue* rather than pure black follows the project's existing tinting approach and avoids the "pure black never appears in nature" problem. Verified: `#ffab00` → `#2e1f00` gives **8.4:1**.

**1.2 — Emit the foreground as a CSS custom property**

- Extend `cssVarNameForCode` (`:236-238`) — its `kind` param is already `"grad" | "bg"`; add `"fg"`.
- In `buildVisitTypeCssText` (`:249-263`), emit `--vt-fg-<CODE>` next to the existing `--vt-bg-` / `--vt-grad-` lines. **Run it through the same `VISIT_TYPE_COLOR_REGEX` validation** — `visitTypeColors.test.ts:161` locks CSS-injection refusal, and a new emitted value is a new injection surface.
- Add `getVisitTypeForeground(code)` mirroring `getVisitTypeColor` (`:279`), returning `var(--vt-fg-CODE, #ffffff)` with a built-in fallback so first paint doesn't flash. Handle the undefined-code case the same way the existing accessors do — `cssVarNameForCode` already maps it to `-none`, and it must resolve to the `DEFAULT_VISIT_TYPE_CONFIG` (`#b0bec5`) foreground, not to bare white.

**1.3 — Same treatment for personal events** — `src/utils/personalEventColors.ts`

Add `getPersonalCategoryForeground(category)` returning a literal hex via `readableForeground`. Note `other` (`#bcaaa4`) and `errand` (`#9e9d24`) are the marginal ones today.

**1.4 — Apply at the render sites** — `src/pages/SchedulePage.tsx`

- `:1874-1876` — add `chipForeground`, mirroring the existing `chipGradient` ternary.
- `:1908` — remove `text-white` from the className.
- `:1919` — add `color: chipForeground` beside `background: chipGradient`.
- `:2085` — external Google Calendar event block: same fix; `bgColor` (`:2081`) is a literal hex from the Google API, so `readableForeground` applies directly.
- `:2217` — touch-drag ghost chip uses `text-white` over `var(--color-primary)`. Theme-controlled, not user-editable — **leave as-is**.

**1.5 — Fix white-assuming chip decoration** — `src/index.css:222`

`.appointment-chip` has `border-left: 3px solid rgba(255,255,255,0.4)`, invisible on a light chip. Change to `currentColor` at 40% via `color-mix`, so it follows the computed foreground. Same for the inset white hairline at `:247`.

**1.6 — Correct the palette comment** — `src/utils/visitTypeColors.ts:151-162`

The comment says the light end of every family is capped because "nothing in the app computes a readable foreground," and claims `visitTypeColors.test.ts` locks this. **That claim is false** — exploration confirmed no test asserts lightness (the tests at `:81-108` only check hex format, duplicates, and built-in presence). After this phase the constraint no longer exists. Rewrite the comment to describe the actual invariants rather than a cap that is now obsolete.

Note `VisitTypeColorPicker.test.tsx:54` requires arbitrary hex from the native color input to keep working — which is exactly why the foreground must be *computed*, not the palette *restricted*.

**1.7 — Tests**

- `src/utils/visitTypeColors.test.ts` — add a contrast suite: every one of the 64 `VISIT_TYPE_HUES` shades, plus every `BUILT_IN_VISIT_TYPE_CONFIGS` `bg` and the `DEFAULT_VISIT_TYPE_CONFIG`, paired with its `readableForeground`, must meet ≥ 4.5:1. This is the regression guard that replaces the removed prose cap.
- Also assert `buildVisitTypeCssText` emits a `--vt-fg-*` line per valid config and **omits it for a malformed `bg`** — matching the existing omission behavior locked at `:146`.
- `src/utils/personalEventColors.ts` has no test file today. Add one covering the same contrast invariant across all categories, since `other` (`#bcaaa4`) and `errand` (`#9e9d24`) are the marginal cases and nothing else guards that path.

---

## Phase 2 — Mobile navigation

`BottomNav.tsx` is already correct (proper `aria-label`s, `aria-hidden` icons, `safe-area-pb`, 64px targets) and its four routes match `App.tsx:47-52` exactly. This is wiring, not authoring — but four collisions must be handled or it lands broken.

**2.1 — Fix the active-state bug in both navs** *(live bug today, independent of BottomNav)*

react-router-dom v6 `NavLink to="/"` without `end` matches every path as a parent, so **Schedule renders active on Patients, Scan and Settings simultaneously**. Add `end` to the `/` item in both `TopNav.tsx:133-135` and `BottomNav.tsx:16-18`.

**2.2 — `BottomNav.tsx:13`** — add `sm:hidden` and an explicit `z-40`. It currently declares **no z-index**, so it would lose to the `z-50` overlays and could be overlapped by the `z-10` sticky header at `PatientsPage.tsx:727`.

**2.3 — `TopNav.tsx:131`** — add `hidden sm:flex` to the center `<nav>`. Because that element carries `flex-1`, hiding it collapses the left and right groups together — add `ml-auto` to the right-hand group at `:151` to keep it pushed right. Also normalize the one-off `md:` at `:145` to `sm:`; `sm:` is the app's convention (7 usages vs 1).

**2.4 — `App.tsx`** — render `<BottomNav />` as a sibling *after* the row wrapper (after `:55`), still inside the `h-screen flex-col` root. Being `fixed`, it stays out of the flex chain.

**2.5 — Scroll clearance** — `main` (`App.tsx:45`) is the app's only scroll container, and `SchedulePage` has no bottom padding of its own (`:1511`), so its time grid would run under the nav. Put the offset on `main`, not per-page.

Add a class next to `.safe-area-pb` (`index.css:121`) using `calc(4rem + env(safe-area-inset-bottom))` — plain `pb-16` ignores the iPhone home-indicator inset. Apply below `sm` only.

**2.6 — Reposition the FABs** — `SchedulePage.tsx:2285` and `PatientsPage.tsx:868` are `fixed bottom-6` (24px), landing **fully behind** a 64px nav. Change to `bottom-24 sm:bottom-6`.

The `bottom-24` toasts (`SchedulePage.tsx:2293`, `UndoDeleteToast.tsx:12`) clear 64px already — leave them.

---

## Phase 3 — Cleanup

**3.1 — Remove Search and Help** — `TopNav.tsx:230-241`, plus the now-unused `Search` / `HelpCircle` imports at `:9-10`. (TypeScript strict mode fails the build on unused imports, so this must be done together.)

**3.2 — Fix font loading** — `index.css:2`

Drop `Google Sans` from the URL — it is proprietary, not served by Google Fonts, so the request fails and the app falls back to Roboto anyway. Then move the remaining Roboto request out of the render-blocking CSS `@import` into a `<link>` in `index.html` with `<link rel="preconnect">` to `fonts.gstatic.com`.

Leave the `body` font stack (`index.css:108`) alone — `'Google Sans'` first is harmless once it simply never resolves, and removing it is a separate typography decision.

**3.3 — Delete `src/App.css`** — dead Vite boilerplate, imported nowhere (`App.tsx` imports only `index.css`). Contains `#root { text-align: center }` and spinning-logo keyframes. It also holds the repo's *only* `prefers-reduced-motion` block, which reads as coverage but is inert — deleting it makes the deferred gap honest.

**3.4 — `App.tsx:47`** — remove `className={... ? '' : ''}`, a ternary between two empty strings.

---

## Verification

Run after **each** phase, per CLAUDE.md ("don't stack multiple changes without verifying the build"):

```powershell
cd pt-scheduler
npx tsc --noEmit      # strict mode: catches unused imports from 3.1
npm test
npm run build
```

**Phase 1 — manual:** `npm run dev`, then in Settings assign a visit type the Amber `#ffab00` and Cyan `#26c6da` swatches, plus a custom near-white hex via the color input (guards `VisitTypeColorPicker.test.tsx:54`). Confirm on the calendar that chip text flips to dark and stays legible, that the left border remains visible, and that all rows (name / facility / miles / address / contacts) flip together. Check a personal event and an external Google Calendar event too — they take different code paths.

**Phase 2 — manual:** DevTools device toolbar at 390px. Confirm BottomNav appears below 640px and vanishes above; the schedule grid scrolls fully clear of it; both FABs sit above it; exactly **one** nav tab is active on each of the four routes (this is the `end` fix); and the bottom sheets in `AppointmentActionSheet` render *over* the nav, not under.

**Phase 3 — manual:** DevTools Network tab, filter `fonts` — confirm no failing `Google+Sans` request and that Roboto loads via preconnect.

**Deploy** once all three phases pass, per the project deploy rule: `npm run build` → commit → `git push origin main` → `cd pt-scheduler && vercel --prod`.

---

## Explicitly out of scope

Not oversights — decided:

- **All dark-mode work** — user does not use dark mode. *One caveat:* the theme default is `"system"`, not `"light"` (`themeStore.ts:15`), so a dark OS setting still triggers dark mode with light grid lines on a dark calendar. If that shows up, `index.css:308-314` is the fix.
- **Touch targets** (~30 sites) — revisit after feeling how BottomNav changes mobile use.
- **WCAG cluster** — modal focus traps, `role="dialog"` on `AddAppointmentModal` / `DayMapModal`, `prefers-reduced-motion`. Real Level A failures, deferred deliberately for a single-user tool.
- **Semantic color tokens** (~150 utilities), type scale, `EmptyState` on Schedule, chip-blur and sidebar-transition performance.
