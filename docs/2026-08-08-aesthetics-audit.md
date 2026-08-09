# PT Scheduler — Aesthetics & Interface Quality Audit

**Date:** 2026-08-08
**Scope:** `pt-scheduler/src` — theming, typography, accessibility, motion, responsive, anti-patterns
**Method:** static review of `index.css`, `tailwind.config.js`, all `src/components/ui/*`, page shells, and color/theme utilities

---

## Anti-Patterns Verdict — **PASS**

Would someone look at this and say "an AI made this"? **No.** This is a clean bill of health on the 2024–25 AI-slop tells:

- No gradient text (`bg-clip-text`: 0 occurrences)
- No glassmorphism (`backdrop-blur`: 1 occurrence, on a modal scrim — legitimate)
- No purple→blue gradients, no neon-on-dark palette
- No hero-metric template, no identical icon+heading+text card grids
- No monospace-as-technical-vibes
- Gradients used only functionally (visit-type chip depth), not decoratively

**The real critique is different:** the app isn't AI-generic, it's *Google-generic*. It is a faithful Google Calendar reproduction — Google Sans, `#1a73e8`, Material elevation shadows, pill nav, FAB. That's a defensible choice for a clinical tool (familiarity reduces training cost), but it means the app has borrowed an identity rather than built one. It is competent and has zero memorable moments of its own.

Two anti-patterns *are* present:

1. **`floatBounce` on empty-state icons** (`index.css:677`) — a perpetual 3s up-down bob. This is exactly the "bounce easing feels dated and tacky" tell, and it never stops.
2. **The 80px washed-out empty-state icon** (`index.css:628`, `opacity: 0.7` on `--color-empty-icon`) — the "large rounded icon above every heading" pattern.

---

## Executive Summary

**28 issues** — 4 Critical, 8 High, 10 Medium, 6 Low.

### Top 5

1. **Tailwind `darkMode` is unset → defaults to `media`, but the app themes via `data-theme`.** 105 `dark:` utilities across 15 files are wired to the wrong signal. Manual Light/Dark in Settings silently fails for every one of them.
2. **Visit-type chips render `text-white` on colors as low as 1.9:1 contrast.** Amber `#ffab00` and Cyan `#26c6da` are unreadable. The code comments *acknowledge* this and freeze the palette around it instead of fixing it.
3. **Four `@media (prefers-color-scheme: dark)` blocks in `index.css` have no `[data-theme="dark"]` twin** — alternating hour bands, dropdown shadows, FAB shadows stay in light mode when dark is manually selected.
4. **No `prefers-reduced-motion` support at all**, alongside three infinite animations. WCAG 2.2.2 violation.
5. **Search and Help buttons in the top nav do nothing** — no `onClick`, no handler. Permanently dead affordances in the app's most prominent chrome.

### Quality Score

| Dimension | Score | Note |
|---|---|---|
| Anti-patterns / taste | 8/10 | Restrained, coherent — but borrowed |
| Theming | 4/10 | Two parallel theme systems, one broken |
| Accessibility | 4/10 | Contrast + motion + dialog gaps |
| Responsive | 6/10 | Mobile nav is icon-only and unlabeled |
| Typography | 5/10 | No scale; primary font never loads |
| Motion | 5/10 | Reasonable curves, no reduced-motion escape |

---

## Critical Issues

### C1 — Tailwind dark mode wired to the wrong signal
**Location:** `tailwind.config.js:6` (missing `darkMode`), affects 105 utilities in 15 files
**Category:** Theming

`tailwind.config.js` never sets `darkMode`, so Tailwind uses its `media` default. But `src/stores/themeStore.ts:23` themes by setting `data-theme="dark"` on `<html>`. These never talk to each other.

**Impact:** A user on a light-mode OS who picks "Dark" in Settings gets CSS-variable surfaces that go dark while every `dark:` utility stays light. Concretely: the Google sign-in pill (`TopNav.tsx:158-162`) renders `bg-green-50` — near-white — against a `#202124` header. Inverse case is worse: dark OS + manual "Light" gives `bg-green-950` on white.

**Fix:** `darkMode: ['selector', '[data-theme="dark"]']` in the Tailwind config. Note this makes `dark:` follow *only* the attribute, so `themeStore` must also stamp `data-theme` in "system" mode (resolve the media query in JS rather than removing the attribute).
**Command:** `/normalize`

---

### C2 — Chip text contrast down to 1.9:1
**Location:** `src/utils/visitTypeColors.ts:156-181`, `src/pages/SchedulePage.tsx:1908`
**Category:** Accessibility — **WCAG 1.4.3 (AA), fails even 1.4.11**

Chips are hardcoded `text-white`. Measured contrast against palette entries:

| Swatch | Contrast vs white | AA (4.5:1) |
|---|---|---|
| `#ffab00` Amber | **1.90:1** | ✗ |
| `#26c6da` Cyan | **1.86:1** | ✗ |
| `#4caf50` Green | 2.78:1 | ✗ |
| `#42a5f5` Blue | 2.60:1 | ✗ |

The source comment reads: *"nothing in the app computes a readable foreground, so the light end of every family is capped at roughly the lightness of the lightest colour already shipping."* The cap is real and enforced by tests — but it's anchored to colors that already fail badly. The invariant preserves the bug.

**Impact:** Appointment chips carry patient name, visit type, and address. At 1.9:1 that text is illegible for low-vision users and washed out for everyone in sunlight — a real condition for a home-health clinician reading a phone in a car.

**Fix:** Compute foreground per chip — WCAG relative luminance, pick `#ffffff` or a dark tint of the chip hue at the ~0.36 luminance threshold. That single change also lifts the palette cap, unlocking the lighter shades the comment currently forbids.
**Command:** `/harden`

---

### C3 — Four dark-mode CSS blocks unreachable under manual theme
**Location:** `src/index.css:301, 411, 485` and the un-themed `:308-314`
**Category:** Theming

These use `@media (prefers-color-scheme: dark)` with no `:root[data-theme="dark"]` counterpart:

- `.hour-even` (301) — alternating hour bands stay `rgba(248,249,250,.5)`, a light wash striping a dark calendar
- `.btn-create` shadow (411)
- `.dropdown-google` shadow + border (485)

And `.grid-line-soft` / `.grid-line-hour` (308–314) hardcode `rgba(218,220,224,…)` with **no dark variant in either system** — light grid lines on `#171717` in every dark mode.

**Impact:** The calendar grid — the app's primary surface — is visibly wrong in manual dark mode. The `--color-*` token block is duplicated correctly for both signals (lines 46–105); these four blocks were missed.
**Fix:** Extract a `@custom-selector`-style shared block or duplicate each into `[data-theme="dark"]`, matching the pattern already used for the tokens.
**Command:** `/normalize`

---

### C4 — Zero reduced-motion support with three infinite animations
**Location:** `src/index.css` — `skeletonShimmer` (539, 1.5s ∞), `floatBounce` (677, 3s ∞), `timePulse` (694, 2s ∞)
**Category:** Accessibility — **WCAG 2.2.2 (A)**

No `@media (prefers-reduced-motion: reduce)` block exists in shipped CSS. The only occurrence in the repo is in `src/App.css:30` — **which is dead Vite boilerplate that nothing imports** (`App.tsx` imports only `index.css`).

**Impact:** Users with vestibular disorders get three continuously-looping animations, one of which (`timePulse` on the current-time marker) runs forever on the default screen. This is a WCAG Level A failure.
**Fix:** Add a global reduced-motion block killing infinite animations and shortening transitions; delete `src/App.css`.
**Command:** `/harden`

---

## High-Severity Issues

### H1 — Semantic status colors bypass the token system entirely
**Location:** 15 files; ~150 `red-*` / `green-*` / `amber-*` utility usages
**Category:** Theming

There is no `--color-error`, `--color-success`, or `--color-warning`. Every error, success, and warning state hardcodes a Tailwind palette class plus a `dark:` twin — which per **C1** doesn't fire. Destructive buttons use `bg-red-600 dark:bg-red-700` (`Button.tsx:14`) while everything adjacent uses `var(--color-*)`.

**Impact:** Status colors are unthemeable and inconsistent (`text-red-600` vs `text-red-500` vs `text-red-700` for the same semantic role). Fixing C1 is necessary but not sufficient — the tokens don't exist to migrate to.
**Fix:** Add error/success/warning token triplets (bg / border / text) to both `:root` blocks; migrate.
**Command:** `/normalize`

---

### H2 — Day-note colors mis-resolve in system dark mode
**Location:** `src/utils/dayNoteColors.ts:28`
**Category:** Theming

```ts
const isDark = document.documentElement.getAttribute("data-theme") === "dark";
```

When mode is `"system"`, `themeStore.ts:20` *removes* the attribute. So a user on a dark-mode OS with the default "System" setting gets `LIGHT_COLORS` — pastel sticky notes on a `#171717` calendar. Two further problems: it reads the DOM during render (not reactive — won't repaint on theme change), and it's unsafe under SSR/tests.

**Fix:** Resolve through a `useThemeStore` selector that returns the *effective* theme, not the raw attribute.
**Command:** `/normalize`

---

### H3 — Dead Search and Help buttons in the top nav
**Location:** `src/components/ui/TopNav.tsx:230-241`
**Category:** UX

Both buttons have `aria-label` and hover states but **no `onClick`**. They are focusable, announce themselves to screen readers as actionable, and do nothing.

**Impact:** Users press Search expecting to find a patient. Nothing happens — the most common read of that is "the app is broken."
**Fix:** Wire Search to a patient/appointment filter, or remove both until implemented. Shipping a visible no-op is worse than shipping less chrome.
**Command:** `/simplify` (remove) or feature work (implement)

---

### H4 — Mobile top nav is icon-only with no accessible names
**Location:** `src/components/ui/TopNav.tsx:143-146`
**Category:** Accessibility — **WCAG 4.1.2 (A)**

```tsx
<NavLink to={to}>
  <Icon className="w-5 h-5" />
  <span className="hidden md:inline">{label}</span>
</NavLink>
```

Below `md`, the label is display-none — the link's entire accessible name disappears. There is no `aria-label` on the `NavLink` (unlike `BottomNav.tsx:27`, which does it correctly). Screen-reader users on mobile hear four unlabeled links.

**Impact:** Primary navigation is unusable with a screen reader on the app's main target device. Compounded by **H5**.
**Fix:** Add `aria-label={label}` to the `NavLink` and mark the icon `aria-hidden`.
**Command:** `/harden`

---

### H5 — `BottomNav` is fully built and never rendered
**Location:** `src/components/ui/BottomNav.tsx` — zero imports repo-wide
**Category:** Responsive / UX

A complete, correctly-implemented mobile bottom nav (proper `aria-label`s, `aria-hidden` icons, `safe-area-pb`, 64px targets) exists and is never mounted. `App.tsx` renders only `TopNav`.

**Impact:** Mobile users navigate via cramped icon-only pills at the top of a 16px-padded header — thumb-hostile on a phone, and precisely the ergonomic problem the unused component solves. Someone built the right answer and didn't wire it up.
**Fix:** Render `BottomNav` below `md` and hide `TopNav`'s center nav there; or delete the file. Don't leave it.
**Command:** `/adapt`

---

### H6 — Two modals with no dialog semantics, Escape, or focus management
**Location:** `src/components/AddAppointmentModal.tsx`, `src/components/DayMapModal.tsx`
**Category:** Accessibility — **WCAG 4.1.2, 2.1.2**

| Modal | `role="dialog"` | Escape | Focus |
|---|---|---|---|
| AppointmentActionSheet | ✓ | ✓ | ✓ |
| AppointmentDetailModal | ✓ | ✓ | ✗ |
| DayNoteModal | ✓ | ✓ | ✓ |
| SlotActionMenu | ✗ | ✓ | ✓ |
| **AddAppointmentModal** | **✗** | **✗** | **✗** |
| **DayMapModal** | **✗** | **✗** | **✗** |

**Impact:** `AddAppointmentModal` is a core creation flow. Without `aria-modal`, screen readers keep reading the calendar behind it; without Escape, keyboard users must tab to find a close button.
**Fix:** Match the `AppointmentActionSheet` pattern — it's already correct in this repo.
**Command:** `/harden`

---

### H7 — No focus trap in any modal
**Location:** all six overlay components
**Category:** Accessibility — **WCAG 2.4.3**

No modal cycles Tab within itself. Tabbing past the last control walks into the calendar grid behind the scrim — which is `aria-hidden`-less and still interactive.

**Impact:** Keyboard users lose their place and can trigger actions on obscured content.
**Fix:** Shared `useFocusTrap` hook applied to all six.
**Command:** `/harden`

---

### H8 — Primary font never loads
**Location:** `src/index.css:2`

```css
@import url('...family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500...');
```

**Google Sans is proprietary and not served by Google Fonts.** That family token makes the request fail, so the app renders in Roboto — the fallback — while paying for a render-blocking cross-origin `@import` on every load.

**Impact:** The intended typographic identity is never realized, and the failed request is on the critical rendering path (a CSS `@import` blocks, and it has no `preconnect`). Roboto is also on the skill's overused-font list, so the *actual* rendered type is the generic one.
**Fix:** Drop `Google Sans` from the URL. Then decide: keep Roboto deliberately (add `<link rel="preconnect">` in `index.html`, move off `@import`), or take the opportunity to pick a distinctive pairing and give the app its own voice.
**Command:** `/optimize` + typography pass

---

## Medium-Severity Issues

### M1 — No type scale; 20+ arbitrary font sizes
**Location:** `SchedulePage.tsx` and throughout
Sizes in use: `9px, 10px, 11px, 12px, 13px, 14px, 16px` as arbitrary values, mixed with `text-xs/sm/base`. No modular scale, no `clamp()`, nothing fluid. Chip text switches between two hardcoded sets by view mode (`1942-2003`).
**Impact:** Inconsistent rhythm and unmaintainable — changing "small label" size means finding every literal.
**Fix:** Define a 6-step scale as tokens; map arbitrary values onto it.
**Command:** `/normalize`

### M2 — 9px and 10px text below legibility floor
**Location:** `SchedulePage.tsx:1696` (`text-[9px]`), `:1718`, `:2098`, `:2102`; `index.css:177` (`.time-axis`, 10px)
**Category:** Accessibility
9px on `--color-text-tertiary` (`#70757a`, 4.6:1 on white) is at the contrast floor *and* below any reasonable size floor. The `:1696` case is an interactive link.
**Fix:** 11px minimum for static, 12px for interactive.
**Command:** `/harden`

### M3 — Focus ring uses `box-shadow`, gets clipped
**Location:** `src/index.css:147-150`
`box-shadow` focus rings are clipped by `overflow: hidden` ancestors — and `.appointment-chip` sets exactly that (`:226`), as does the scrolling grid. Also invisible in Windows High Contrast (forced-colors strips shadows).
**Fix:** `outline: 2px solid var(--color-primary); outline-offset: 2px` — outlines aren't clipped and survive forced-colors.
**Command:** `/harden`

### M4 — Global touch-target minimum is 36px, not 44px
**Location:** `src/index.css:153-156`
**Category:** Accessibility — **WCAG 2.5.8 (AA, 24px) passes; Apple HIG (44px) fails**
`min-height: 36px` globally, with `.btn-sm` opting out entirely (`min-height: unset`).
**Impact:** On a PWA used one-handed in the field, 36px targets — and unbounded `.btn-sm` ones — cause mis-taps. Nav chevrons at `h-7` (28px, `SchedulePage.tsx:1517`) are below even the WCAG minimum once padding is excluded.
**Fix:** Raise to 44px for touch; give `.btn-sm` a floor rather than `unset`.
**Command:** `/adapt`

### M5 — Chip hover animates a blurred pseudo-element
**Location:** `src/index.css:252-261`
`filter: blur(8px)` on a `::before` created at hover time. Blur is expensive, and creating the pseudo-element on hover forces a paint. On a week view with 40+ chips this is measurable on mid-range Android.
**Fix:** Pre-create the element at `opacity: 0` and transition opacity only; or drop the glow — it's decorative.
**Command:** `/optimize`

### M6 — `.sidebar` transitions `width` and `margin-left`
**Location:** `src/index.css:443-445`
Both are layout properties — every frame triggers reflow of the entire calendar grid.
**Fix:** `transform: translateX()` with the sidebar out of flow, or `grid-template-columns` transition.
**Command:** `/optimize`

### M7 — `#facc15` etc. duplicated across three files
**Location:** `DayNoteModal.tsx:200-205`, `dayNoteColors.ts:9-24`, `SchedulePage.tsx:2245-2247`
The same day-note palette is written out in three places; `SchedulePage:2245` inlines yellow's light triplet directly, so it won't follow a dark theme even after H2 is fixed.
**Fix:** Single export from `dayNoteColors.ts`.
**Command:** `/extract`

### M8 — `theme-color` meta is hardcoded white
**Location:** `index.html:10`
`<meta name="theme-color" content="#ffffff">` with no dark variant. In a PWA the iOS/Android status bar stays white against a dark app.
**Fix:** Two `theme-color` metas with `media="(prefers-color-scheme: …)"`, plus a JS update on manual theme change.
**Command:** `/harden`

### M9 — Empty-state icon float animation
**Location:** `src/index.css:677-688`
Infinite 3s bob (see also C4). It's the "bounce feels dated" anti-pattern and adds nothing.
**Fix:** Remove.
**Command:** `/quieter`

### M10 — `EmptyState` used on exactly one page
**Location:** `src/components/ui/EmptyState.tsx` — 183 lines, imported only by `PatientsPage.tsx`
The Schedule page — where an empty day is the most common and most teachable empty state — doesn't use it.
**Impact:** Missed chance to teach the interface at the moment users need it. Per the design guidance, empty states should teach, not just report absence.
**Command:** `/onboard`

---

## Low-Severity Issues

- **L1** — `src/App.css` is dead Vite boilerplate (42 lines, `#root { text-align: center }`, spinning-logo keyframes). Delete. Note it holds the repo's only reduced-motion block, which reads as coverage but isn't.
- **L2** — `App.tsx:47` — `className={... ? '' : ''}` — a ternary between two empty strings.
- **L3** — `tailwind.config.js` has an empty `theme.extend`. Every token goes through arbitrary `[var(--color-*)]` syntax, which is verbose and defeats Tailwind's autocomplete. Map the CSS vars into `theme.extend.colors`.
- **L4** — `.stagger-item` / `.skeleton-stagger` delays hardcoded to 10 and 5 children; item 11+ animates with no delay.
- **L5** — Transition tokens exist (`--duration-fast/normal/slow`) but ~15 rules still hardcode `0.2s` / `0.1s` (`index.css:285, 329, 355, 444, 498`).
- **L6** — `.event-chip` (`index.css:208`) appears unused — superseded by `.appointment-chip`.

---

## Systemic Patterns

1. **Two theme systems that disagree.** CSS custom properties handle both `media` and `data-theme` correctly. Tailwind `dark:` handles only `media`. Four `index.css` blocks handle only `media`. `dayNoteColors` handles only `data-theme`. Four sources of truth, three of them partial. **This single root cause drives C1, C3, H1, H2, and M8** — fix the wiring and five findings collapse.

2. **Correct implementations that aren't wired up.** `BottomNav` (H5), `EmptyState` (M10), the `AppointmentActionSheet` dialog pattern (H6), the duration tokens (L5). The good work exists; adoption is the gap. Cheapest wins in the report.

3. **Semantic color has no token layer.** Surfaces/text/borders are tokenized; error/success/warning are not (H1). Every status treatment is a one-off.

4. **Typography was never systematized.** No scale, no fluid sizing, and the intended font doesn't load (H8, M1, M2).

---

## Positive Findings

- **`visitTypeColors.ts` is exemplary.** Documented invariants, reasoning captured in comments, locked by tests, an external store with `useSyncExternalStore` so chips repaint without prop-drilling. The palette cap is wrong (C2) but it's *deliberately* wrong and says so — that's how constraints should be recorded.
- **Restrained visual language.** No gradient text, no glass, no neon. The team resisted every fashionable tell.
- **`--color-*` token block is complete and correctly duplicated** across `media` and `data-theme` — 22 tokens, no gaps. The bugs are in the code that skipped this pattern, not the pattern.
- **`AppointmentActionSheet`** is a textbook accessible sheet: `role`, `aria-modal`, Escape, focus. Use it as the reference for H6.
- **`input-google` uses `font-size: max(16px, 0.875rem)`** with a comment explaining iOS zoom prevention — exactly the kind of detail most apps miss.
- **`safe-area-inset` handling** on body and `.safe-area-pb` shows real PWA-on-iOS attention.
- **`Card`'s clickable variant** adds `role="button"`, `tabIndex`, and Enter/Space handling rather than leaving a bare clickable div.

---

## Recommendations by Priority

### 1. Immediate — the theme wiring (fixes 5 findings)
1. Set `darkMode: ['selector', '[data-theme="dark"]']`; make `themeStore` stamp the resolved theme in system mode **(C1)**
2. Add `[data-theme="dark"]` twins for the four orphaned `index.css` blocks; give grid lines a dark variant **(C3)**
3. Fix `dayNoteColors` to read effective theme via the store **(H2)**

### 2. Short-term — accessibility floor
4. Compute readable chip foreground; lift the palette cap **(C2)**
5. Add the global `prefers-reduced-motion` block; delete `App.css` **(C4, L1, M9)**
6. `aria-label` on TopNav links; `role="dialog"` + Escape on the two bare modals **(H4, H6)**
7. Remove or implement Search and Help **(H3)**
8. Drop `Google Sans` from the font URL; add `preconnect` **(H8)**

### 3. Medium-term — system consistency
9. Add error/success/warning tokens; migrate ~150 utilities **(H1)**
10. Render `BottomNav` below `md` **(H5)**
11. Shared focus trap **(H7)**
12. Define a type scale; raise 9px text **(M1, M2)**
13. Outline-based focus ring; 44px touch targets **(M3, M4)**

### 4. Long-term
14. Performance: chip blur, sidebar layout transitions **(M5, M6)**
15. Consolidate day-note colors; map tokens into Tailwind theme **(M7, L3)**
16. Extend `EmptyState` to the Schedule page **(M10)**
17. **Decide whether to keep being Google Calendar.** Everything above is repair work. The open design question is whether a home-health PT tool should wear Google's identity or its own — the field context (one-handed, in a car, in sunlight, between visits) is nothing like Google Calendar's desktop-first assumptions, and a design built for *that* would look meaningfully different.

---

## Suggested Commands

| Command | Addresses | Findings |
|---|---|---|
| `/normalize` | Theme wiring, tokens, type scale | C1, C3, H1, H2, M1, M7 |
| `/harden` | Contrast, motion, dialogs, focus, i18n | C2, C4, H4, H6, H7, M2, M3, M8 |
| `/optimize` | Font loading, blur, layout transitions | H8, M5, M6 |
| `/adapt` | Mobile nav, touch targets | H5, M4 |
| `/simplify` | Dead code, no-op buttons | H3, L1, L2, L6 |
| `/onboard` | Schedule empty state | M10 |
| `/quieter` | Float animation | M9 |

**Recommended order:** `/normalize` → `/harden` → `/adapt` → `/optimize`. Normalize first — it collapses the systemic theme problem, and several harden findings are easier to verify once dark mode is actually correct.
