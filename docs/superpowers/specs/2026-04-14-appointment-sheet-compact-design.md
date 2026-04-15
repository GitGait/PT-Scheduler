# Appointment Action Sheet — Compact Layout

**Date:** 2026-04-14
**File touched:** `pt-scheduler/src/components/AppointmentActionSheet.tsx`
**Status:** Design approved, ready for implementation plan

## Problem

Tapping an appointment chip opens a bottom sheet that has become crowded:

- Each phone number consumes **two full-width rows** (Call + Text), duplicating the formatted number
- A patient with 3 contacts (primary + 2 alternates) eats 6 rows before the address even appears
- The 6 management actions (View/Edit, Move, Copy, Quick Note, Hold, Delete) stack as 6 more full-width rows
- Worst-case sheet has ~13 rows before the Delete action, requiring scroll on phones

The user wants a compact layout that keeps every action accessible without scrolling in the common case.

## Constraints

- **Touch-first**: used in the field on phones, also on desktop when planning. Hover tooltips can be a desktop bonus but cannot be the only way to identify an icon.
- **Tap target size**: iOS minimum 44×44 for primary touch targets.
- **Preserve all existing capabilities**: no features removed, all handler props and call sites unchanged.
- **Minimize file growth**: already a moderate-size component; add structure without bloat.

## Design

### 1. Contact rows

Replace the current pattern of two full-width rows per phone number with **one row per contact**. Each row has:

- Small colored indicator (36px circle, role-colored)
- Contact name and role on the left: `John Smith` or `Mary · wife`
- Formatted phone number beneath the name
- Three mini action buttons on the right: **Call**, **Text**, **Copy**. Each button is at least 44×44 (iOS minimum tap size), rounded, and visually compact so all three fit on the smallest supported viewport without truncating the name/number stack.

Color roles (unchanged from today — use the same Tailwind / CSS variable tokens that the current rows use, not new hex values):

- **Primary patient**: `--color-primary-light` background + `--color-primary` foreground (blue in the default theme)
- **Alternate contact**: `bg-amber-100 dark:bg-amber-950` + `text-amber-500 dark:text-amber-400`
- **Address**: `bg-green-100 dark:bg-green-950` + `text-green-600 dark:text-green-400`

The **address row** follows the same template but with only **Navigate** and **Copy** action buttons (no call/text). Address text goes where name+number would, truncated if long.

Personal events (no patient) skip the contact section entirely, same as today.

### 2. Icon action bar

Replace the 6 stacked management rows with a **6-column grid** beneath a divider:

| Slot | Icon | Label | Color |
|------|------|-------|-------|
| 1 | `Edit3` | Edit | gray |
| 2 | `Move` | Move | purple |
| 3 | `Copy` | Copy | teal |
| 4 | `StickyNote` | Note | amber |
| 5 | `PauseCircle` | Hold | amber |
| 6 | `Trash2` | Delete | red |

Each cell:

- 38×38 colored circle with the icon
- Label directly beneath at `text-[10px]` or `text-[11px]`, **always visible** (not hover-only)
- Full cell is the tap target (icon + label + padding), giving a ~64×64 tap zone
- `aria-label` carrying the full verbose label ("View / Edit Details", "Copy Appointment", "Delete Appointment", etc.)
- HTML `title` attribute so desktop shows a native tooltip with the full verbose label on hover

Tap handlers call the existing props unchanged: `onViewEdit`, `onMove`, `onCopy`, `onChipNote` flow (via inline expansion), `onHold`, `onDelete`.

### 3. Note inline expansion

Tapping the **Note** icon in the action bar expands the existing note editor **inline below the action bar**. No sub-sheet, no navigation layer. The expanded editor is the same UI as today:

- List of existing notes with per-note edit and remove
- Add-note input with Enter-to-commit
- Color picker (amber/pink/blue/etc. swatches)
- `Apply to all` checkbox (patient-level save)
- `Remove from all` confirm-then-execute button
- Save button

Component-internal state (`chipNoteMode`, `notes`, `selectedColor`, etc.) and the save pipeline (`onChipNote` vs `onPatientChipNote`) are unchanged.

While expanded, the sheet's existing `max-h-[80vh] overflow-y-auto` handles tall note states by scrolling.

### 4. Header, frame, and ancillary behavior (unchanged)

- Sticky header with patient name (or personal-event title) and ✕ close button
- Bottom-sheet presentation, backdrop click to close, Escape key to close
- Cancel button at the bottom of the sheet
- Appointment-id change effect resetting local state on switch
- Copy-to-clipboard success indicator (green check for 1.5s) on the Copy mini button

### 5. Component structure

Extract two small sub-components as private (non-exported) helpers in the same file to keep the main JSX readable:

- **`ContactRow`** — renders one contact line with configurable color role, label, phone/address text, and a set of action mini-buttons. Takes `copyKey` so the parent's `copiedKey` state still drives the check-mark feedback.
- **`IconBarButton`** — renders one cell of the 6-icon action bar (circle + icon + label + aria-label + title).

Everything else stays as-is in the main function component.

### 6. Cleanups bundled in

- Remove the dead `appointment.status !== "on-hold"` guard around the Hold action. On-hold appointments are filtered out of `useAppointmentStore.appointments` (see `appointmentStore.ts:102`) and live exclusively in `onHoldAppointments`, surfaced only via the sidebar. The chip never renders for them, so the action sheet is never opened in that state. Removing the branch simplifies the JSX.
- No other behavior changes, no unrelated refactors.

## What is explicitly NOT changing

- No changes to props or call sites (`SchedulePage.tsx` usage stays identical)
- No changes to the underlying note data model or save semantics
- No changes to on-hold / restore-from-hold workflow
- No changes to the header, no "hero action strip" (Option B was considered and rejected)
- No progressive disclosure / "More…" button (Option C was considered and rejected)

## Success criteria

A worst-case sheet (primary patient + 2 alt contacts + address + all management actions) fits within a single phone viewport without scrolling on a 5.5"+ device:

- **Today**: ~13 rows + Cancel ≈ 800+px tall (scrolls on most phones)
- **After**: 4 contact rows (~68px each) + 1 action bar row (~80px) + header (~56px) + divider + cancel (~56px) ≈ ~470px tall (fits comfortably)

All existing tap behaviors still work, no capability regression, no accessibility regression (all icons still have discoverable labels via always-visible text or `aria-label`).

## Testing notes

- Visual verification on mobile viewport (primary use case)
- Verify Note inline expansion still works end-to-end (add, edit, remove, color, apply-to-all, remove-from-all, save)
- Verify Copy mini-button still shows the green check feedback
- Verify personal-event branch still skips contact section
- Verify tapping Call/Text still closes the sheet via `onClose` (unchanged)
