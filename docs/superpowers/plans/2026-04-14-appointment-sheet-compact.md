# Appointment Action Sheet — Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `AppointmentActionSheet.tsx` so each contact becomes one row (with inline Call / Text / Copy mini buttons) and the six management actions collapse into a 6-icon bar with always-visible labels.

**Architecture:** Single-file refactor. Two private, non-exported helper components (`ContactRow`, `IconBarButton`) are defined at the bottom of `AppointmentActionSheet.tsx` and consumed above. All props on the exported `AppointmentActionSheet` component are unchanged so `SchedulePage.tsx` keeps working untouched. No new files, no store changes, no behavior changes outside the visual layout.

**Tech Stack:** React 18 function components, TypeScript strict, Tailwind CSS with project CSS variables, Lucide icons, Vite build.

**Spec:** `docs/superpowers/specs/2026-04-14-appointment-sheet-compact-design.md`

**Primary file:** `pt-scheduler/src/components/AppointmentActionSheet.tsx`

**Verification gates used in every task:**
- `cd pt-scheduler && npm run build` — must succeed, no TypeScript errors
- `npx tsc --noEmit` (quick type-check inside `pt-scheduler/`) — optional fast path between builds
- Visual check via `npm run dev` at mobile viewport (Chrome DevTools device toolbar, iPhone 12 Pro preset)

This project has **no existing test file** for this component and the task is pure visual/layout. Verification is build-passes + visual walk-through per the "Final verification" task at the end. Do not invent a new test suite for this component.

---

## File map

| Path | Change | Why |
|------|--------|-----|
| `pt-scheduler/src/components/AppointmentActionSheet.tsx` | Modify | All layout changes land here |
| (no other files) | — | Call site in `SchedulePage.tsx` is prop-compatible and untouched |

All edits stay inside the one file.

---

## Task 1: Add `ContactRow` helper component (defined but not yet used)

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx` (append helper at end of file, before the existing `export function AppointmentActionSheet` closing)

**Context:** `ContactRow` renders one of four shapes used by the sheet today (primary patient call+text row, alt-contact call+text row, address navigate row). It's generic over: the role (determines colors), the left-side label stack (name + secondary line), and the right-side action buttons array. It also takes `copiedKey` and `copyKeyToMatch` so the parent's existing `copiedKey` state drives the green-check feedback on the Copy button without moving state into the child.

- [ ] **Step 1.1: Read the current file to find the right insertion point**

Run:
```bash
rg -n "^export function AppointmentActionSheet" pt-scheduler/src/components/AppointmentActionSheet.tsx
```
Expected: one hit at line ~63.

The new helper will go **after** the existing `export function AppointmentActionSheet(...) { ... }` block, at the bottom of the file. TypeScript hoists function declarations within the same module, so placing helpers below the consumer is fine.

- [ ] **Step 1.2: Append the `ContactRow` component to the bottom of the file**

Add this code at the very end of `AppointmentActionSheet.tsx`, after the closing `}` of the main exported function:

```tsx
// ---------- Private helpers ----------

type ContactRole = "primary" | "alt" | "address";

interface ContactRowAction {
    key: string;
    icon: React.ReactNode;
    onClick: () => void;
    ariaLabel: string;
    /** When set, renders a green check instead of the icon if copiedKey === key */
    copyable?: boolean;
}

interface ContactRowProps {
    role: ContactRole;
    /** Icon rendered in the left badge (a Lucide icon element) */
    leadIcon: React.ReactNode;
    /** First line (e.g. "John Smith" or "Mary · wife" or "1420 Oak Lane") */
    primaryText: string;
    /** Second line (phone number or address line 2) — optional */
    secondaryText?: string;
    actions: ContactRowAction[];
    copiedKey: string | null;
}

function ContactRow({
    role,
    leadIcon,
    primaryText,
    secondaryText,
    actions,
    copiedKey,
}: ContactRowProps) {
    const badgeClass =
        role === "primary"
            ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
            : role === "alt"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-500 dark:text-amber-400"
            : "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400";

    const actionBtnClass =
        role === "primary"
            ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] hover:brightness-95"
            : role === "alt"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900"
            : "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900";

    const copyBtnClass =
        "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:brightness-95";

    return (
        <div className="flex items-center gap-3 py-2 px-3">
            <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${badgeClass}`}>
                {leadIcon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {primaryText}
                </div>
                {secondaryText && (
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        {secondaryText}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
                {actions.map((action) => {
                    const showCheck = action.copyable && copiedKey === action.key;
                    const isCopy = action.copyable === true;
                    return (
                        <button
                            key={action.key}
                            type="button"
                            onClick={action.onClick}
                            aria-label={action.ariaLabel}
                            title={action.ariaLabel}
                            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                                isCopy ? copyBtnClass : actionBtnClass
                            }`}
                        >
                            {showCheck ? (
                                <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                            ) : (
                                action.icon
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 1.3: TypeScript will complain — `ContactRow` is unused**

The project enforces "no unused variables." At this point `ContactRow` is defined but not called. **Do not commit yet.** Proceed directly to Task 2 which wires it in — Task 1 + Task 2 land in the same commit.

- [ ] **Step 1.4: Verify the file still parses**

Run:
```bash
cd pt-scheduler && npx tsc --noEmit
```
Expected: one error about `ContactRow` being declared but never read. No other errors. Continue to Task 2.

---

## Task 2: Use `ContactRow` for the primary patient call+text

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx` (replace the two existing Call Patient / Text Patient blocks with a single `ContactRow`)

**Context:** Today's lines ~270-316 render two stacked full-width rows for the primary patient: one Call with a trailing Copy button, and one Text. Replace both with a single `ContactRow` carrying three actions.

- [ ] **Step 2.1: Locate the existing primary patient block**

Run:
```bash
rg -n "Call Patient|Text Patient" pt-scheduler/src/components/AppointmentActionSheet.tsx
```
Expected: matches around the rows that start with `{/* Call Patient (Primary) */}` and `{/* Text Patient (Primary) */}`.

- [ ] **Step 2.2: Delete both the Call Patient and Text Patient blocks and replace with a single `ContactRow`**

In `AppointmentActionSheet.tsx`, find this block (approximately lines 271-316 of the current file):

```tsx
                    {/* Call Patient (Primary) */}
                    {hasPhone && phoneHref && (
                        <div className="flex items-center">
                            <a
                                href={phoneHref}
                                onClick={onClose}
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                                    <Phone className="w-5 h-5 text-[var(--color-primary)]" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Call Patient</span>
                                    <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(primaryPhone)}</span>
                                </div>
                            </a>
                            <button
                                onClick={() => copyToClipboard(primaryPhone ?? '', 'phone')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                                aria-label="Copy phone number"
                            >
                                {copiedKey === 'phone' ? (
                                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Text Patient (Primary) */}
                    {hasPhone && smsHref && (
                        <a
                            href={smsHref}
                            onClick={onClose}
                            className="w-full flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                        >
                            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                                <MessageSquare className="w-5 h-5 text-[var(--color-primary)]" />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-medium">Text Patient</span>
                                <span className="text-sm text-[var(--color-text-secondary)]">{formatPhoneDisplay(primaryPhone)}</span>
                            </div>
                        </a>
                    )}
```

Replace with:

```tsx
                    {/* Primary patient contact */}
                    {hasPhone && (
                        <ContactRow
                            role="primary"
                            leadIcon={<Phone className="w-4 h-4" />}
                            primaryText={!isPersonal ? (patient?.fullName ?? "Patient") : headerName}
                            secondaryText={formatPhoneDisplay(primaryPhone)}
                            copiedKey={copiedKey}
                            actions={[
                                {
                                    key: "call-primary",
                                    icon: <Phone className="w-5 h-5" />,
                                    ariaLabel: "Call patient",
                                    onClick: () => {
                                        if (phoneHref) {
                                            window.location.href = phoneHref;
                                        }
                                        onClose();
                                    },
                                },
                                {
                                    key: "text-primary",
                                    icon: <MessageSquare className="w-5 h-5" />,
                                    ariaLabel: "Text patient",
                                    onClick: () => {
                                        if (smsHref) {
                                            window.location.href = smsHref;
                                        }
                                        onClose();
                                    },
                                },
                                {
                                    key: "phone",
                                    icon: <Copy className="w-4 h-4" />,
                                    ariaLabel: "Copy phone number",
                                    copyable: true,
                                    onClick: () => copyToClipboard(primaryPhone ?? "", "phone"),
                                },
                            ]}
                        />
                    )}
```

**Note:** `key: "phone"` for the Copy action is intentional — it reuses the existing `copiedKey === 'phone'` state value so feedback keeps working without touching the copy state logic.

- [ ] **Step 2.3: Run the build**

Run:
```bash
cd pt-scheduler && npm run build
```
Expected: build succeeds, no TypeScript errors. `ContactRow` is now consumed.

- [ ] **Step 2.4: Visual check**

Run `cd pt-scheduler && npm run dev`, open the app at mobile viewport, open an appointment chip, confirm:
- A single compact row replaces the previous two stacked Call/Text rows
- Tapping Call triggers the tel: link and closes the sheet
- Tapping Text triggers the sms: link and closes the sheet
- Tapping Copy shows a green check for ~1.5s and the phone number is on the clipboard

- [ ] **Step 2.5: Commit**

```bash
cd "C:\Users\Isom\Desktop\Projects\Scheduler app"
git add pt-scheduler/src/components/AppointmentActionSheet.tsx
git commit -m "refactor: extract ContactRow helper, collapse primary patient call+text into one row"
```

---

## Task 3: Convert alternate contacts loop to use `ContactRow`

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx` (replace the alt-contact `.map()` block)

**Context:** Today's alternate contacts loop renders two stacked rows per contact. Replace with one `ContactRow` per contact, still inside the same `.map()`.

- [ ] **Step 3.1: Locate the alt-contact block**

Run:
```bash
rg -n "alternateContacts.map" pt-scheduler/src/components/AppointmentActionSheet.tsx
```
Expected: one hit where `alternateContacts.map((contact, index) => { ... })` begins.

- [ ] **Step 3.2: Replace the entire alt-contact map block**

Find the block that currently reads (approximately):

```tsx
                    {/* Alternate Contacts */}
                    {alternateContacts.map((contact, index) => {
                        const altPhoneHref = buildPhoneHref(contact.phone);
                        const altSmsHref = buildSmsHref(contact.phone);
                        const contactLabel = contact.firstName + (contact.relationship ? ` (${contact.relationship})` : "");
                        const altCopyKey = `alt-phone-${index}`;

                        return (
                            <div key={index}>
                                {/* Call Alternate */}
                                {altPhoneHref && (
                                    <div className="flex items-center">
                                        {/* ... big Call row with copy button ... */}
                                    </div>
                                )}

                                {/* Text Alternate */}
                                {altSmsHref && (
                                    <a /* ... big Text row ... */ />
                                )}
                            </div>
                        );
                    })}
```

Replace the entire `{alternateContacts.map(...)}` block with:

```tsx
                    {/* Alternate Contacts */}
                    {alternateContacts.map((contact, index) => {
                        const altPhoneHref = buildPhoneHref(contact.phone);
                        const altSmsHref = buildSmsHref(contact.phone);
                        if (!altPhoneHref && !altSmsHref) return null;

                        const label = contact.firstName + (contact.relationship ? ` · ${contact.relationship}` : "");
                        const altCopyKey = `alt-phone-${index}`;

                        const actions: ContactRowAction[] = [];
                        if (altPhoneHref) {
                            actions.push({
                                key: `alt-call-${index}`,
                                icon: <Phone className="w-5 h-5" />,
                                ariaLabel: `Call ${label}`,
                                onClick: () => {
                                    window.location.href = altPhoneHref;
                                    onClose();
                                },
                            });
                        }
                        if (altSmsHref) {
                            actions.push({
                                key: `alt-text-${index}`,
                                icon: <MessageSquare className="w-5 h-5" />,
                                ariaLabel: `Text ${label}`,
                                onClick: () => {
                                    window.location.href = altSmsHref;
                                    onClose();
                                },
                            });
                        }
                        actions.push({
                            key: altCopyKey,
                            icon: <Copy className="w-4 h-4" />,
                            ariaLabel: `Copy ${label} phone number`,
                            copyable: true,
                            onClick: () => copyToClipboard(contact.phone, altCopyKey),
                        });

                        return (
                            <ContactRow
                                key={`alt-${index}`}
                                role="alt"
                                leadIcon={<User className="w-4 h-4" />}
                                primaryText={label}
                                secondaryText={formatPhoneDisplay(contact.phone)}
                                copiedKey={copiedKey}
                                actions={actions}
                            />
                        );
                    })}
```

- [ ] **Step 3.3: Add `User` to the lucide-react import**

Find the existing import line at the top of the file:

```tsx
import { Phone, MessageSquare, Navigation, Edit3, Move, Trash2, X, Copy, Check, PauseCircle, StickyNote, Plus, Pencil } from "lucide-react";
```

Add `User` to the list:

```tsx
import { Phone, MessageSquare, Navigation, Edit3, Move, Trash2, X, Copy, Check, PauseCircle, StickyNote, Plus, Pencil, User } from "lucide-react";
```

- [ ] **Step 3.4: Run the build**

```bash
cd pt-scheduler && npm run build
```
Expected: build succeeds.

- [ ] **Step 3.5: Visual check**

Open an appointment chip for a patient with at least one alternate contact. Verify:
- Each alt contact is one compact amber row
- Call / Text / Copy buttons all work (tel:, sms:, clipboard)
- Copy shows green check feedback

- [ ] **Step 3.6: Commit**

```bash
cd "C:\Users\Isom\Desktop\Projects\Scheduler app"
git add pt-scheduler/src/components/AppointmentActionSheet.tsx
git commit -m "refactor: collapse alternate contact call+text into single ContactRow per contact"
```

---

## Task 4: Convert the address row to use `ContactRow`

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx`

**Context:** The address row has Navigate and Copy actions only (no call/text), with a different color (green). `ContactRow` already supports the `"address"` role.

- [ ] **Step 4.1: Locate the Navigate to Address block**

Run:
```bash
rg -n "Navigate to Address" pt-scheduler/src/components/AppointmentActionSheet.tsx
```
Expected: one hit in the JSX.

- [ ] **Step 4.2: Replace the address block**

Find the current block (approximately):

```tsx
                    {/* Navigate to Address */}
                    {hasAddress && (
                        <div className="flex items-center">
                            <button
                                onClick={() => {
                                    onNavigate();
                                    onClose();
                                }}
                                className="flex-1 flex items-center gap-4 py-3 px-4 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                            >
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                                    <Navigation className="w-5 h-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium">Navigate to Address</span>
                                    <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[250px]">{patient?.address}</span>
                                </div>
                            </button>
                            <button
                                onClick={() => copyToClipboard(patient?.address ?? '', 'address')}
                                className="p-2.5 mr-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                                aria-label="Copy address"
                            >
                                {copiedKey === 'address' ? (
                                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                )}
                            </button>
                        </div>
                    )}
```

Replace with:

```tsx
                    {/* Address */}
                    {hasAddress && (
                        <ContactRow
                            role="address"
                            leadIcon={<Navigation className="w-4 h-4" />}
                            primaryText="Address"
                            secondaryText={patient?.address}
                            copiedKey={copiedKey}
                            actions={[
                                {
                                    key: "navigate",
                                    icon: <Navigation className="w-5 h-5" />,
                                    ariaLabel: "Navigate to address",
                                    onClick: () => {
                                        onNavigate();
                                        onClose();
                                    },
                                },
                                {
                                    key: "address",
                                    icon: <Copy className="w-4 h-4" />,
                                    ariaLabel: "Copy address",
                                    copyable: true,
                                    onClick: () => copyToClipboard(patient?.address ?? "", "address"),
                                },
                            ]}
                        />
                    )}
```

- [ ] **Step 4.3: Run the build**

```bash
cd pt-scheduler && npm run build
```
Expected: build succeeds.

- [ ] **Step 4.4: Visual check**

Open an appointment whose patient has an address. Verify:
- Single green row with "Address" + the address line
- Navigate button still opens maps
- Copy button shows green check and copies the address

- [ ] **Step 4.5: Commit**

```bash
cd "C:\Users\Isom\Desktop\Projects\Scheduler app"
git add pt-scheduler/src/components/AppointmentActionSheet.tsx
git commit -m "refactor: convert address row to ContactRow"
```

---

## Task 5: Add `IconBarButton` helper (defined but not yet used)

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx` (append helper at end of file, after `ContactRow`)

**Context:** Each cell of the 6-icon action bar is a vertical stack of colored circle + label. The circle color varies per action. Per Task 1's note about the "no unused variables" rule, Task 5 + Task 6 land in the same commit.

- [ ] **Step 5.1: Append the helper at the bottom of the file (after `ContactRow`)**

```tsx
interface IconBarButtonProps {
    icon: React.ReactNode;
    label: string;
    ariaLabel: string;
    onClick: () => void;
    /** One of the preset tint slots */
    tint: "neutral" | "purple" | "teal" | "amber" | "red";
    /** Label color overrides (used for Delete) */
    labelDanger?: boolean;
}

function IconBarButton({
    icon,
    label,
    ariaLabel,
    onClick,
    tint,
    labelDanger,
}: IconBarButtonProps) {
    const circleClass =
        tint === "neutral"
            ? "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
            : tint === "purple"
            ? "bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400"
            : tint === "teal"
            ? "bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400"
            : tint === "amber"
            ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
            : "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400";

    const labelClass = labelDanger
        ? "text-red-600 dark:text-red-400"
        : "text-[var(--color-text-secondary)]";

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={ariaLabel}
            className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
        >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${circleClass}`}>
                {icon}
            </div>
            <span className={`text-[11px] font-medium leading-tight ${labelClass}`}>
                {label}
            </span>
        </button>
    );
}
```

- [ ] **Step 5.2: Proceed directly to Task 6**

Do not build or commit yet — `IconBarButton` is unused until Task 6 wires it in.

---

## Task 6: Replace the 6 stacked management rows with the icon action bar

**Files:**
- Modify: `pt-scheduler/src/components/AppointmentActionSheet.tsx`

**Context:** Today the file has six consecutive full-width buttons (View/Edit, Move, Copy, Quick Note, Put on Hold, Delete) interleaved with the `chipNoteMode` inline-expansion block. The refactor: render a single icon bar with six `IconBarButton`s, and render the existing note expansion block **below** the icon bar when `chipNoteMode` is true. The Note icon button sets `setChipNoteMode(true)`, identical to today's Quick Note button behavior.

- [ ] **Step 6.1: Locate the management rows**

Run:
```bash
rg -n "View / Edit Details|Move Appointment|Copy Appointment|Put on Hold|Delete Appointment" pt-scheduler/src/components/AppointmentActionSheet.tsx
```
Expected: hits for each label.

- [ ] **Step 6.2: Replace the management section**

Find the region that starts with the divider comment:

```tsx
                    {/* Divider */}
                    <div className="my-2 border-t border-[var(--color-border)]" />

                    {/* View / Edit Details */}
                    <button ...>...</button>

                    {/* Move Appointment */}
                    <button ...>...</button>

                    {/* Copy Appointment */}
                    <button ...>...</button>

                    {/* Quick Notes */}
                    {chipNoteMode ? (
                        <div className="px-4 py-3 space-y-2">
                            {/* ... full note editor ... */}
                        </div>
                    ) : (
                        <button onClick={() => setChipNoteMode(true)} ...>
                            {/* ... Quick Note button ... */}
                        </button>
                    )}

                    {/* Put on Hold */}
                    {appointment.status !== "on-hold" && (
                        <button ...>...</button>
                    )}

                    {/* Delete Appointment */}
                    <button ...>...</button>
```

Replace **everything from the Divider comment through the closing of the Delete Appointment `<button>`** with:

```tsx
                    {/* Divider */}
                    <div className="my-2 border-t border-[var(--color-border)]" />

                    {/* Icon action bar */}
                    <div className="grid grid-cols-6 gap-1 px-1 pt-1">
                        <IconBarButton
                            tint="neutral"
                            icon={<Edit3 className="w-5 h-5" />}
                            label="Edit"
                            ariaLabel="View / Edit Details"
                            onClick={() => {
                                onViewEdit();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="purple"
                            icon={<Move className="w-5 h-5" />}
                            label="Move"
                            ariaLabel="Move Appointment"
                            onClick={() => {
                                onMove();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="teal"
                            icon={<Copy className="w-5 h-5" />}
                            label="Copy"
                            ariaLabel="Copy Appointment"
                            onClick={() => {
                                onCopy();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="amber"
                            icon={<StickyNote className="w-5 h-5" />}
                            label={noteCount > 0 ? "Notes" : "Note"}
                            ariaLabel={noteCount > 0 ? "Edit Notes" : "Add Quick Note"}
                            onClick={() => setChipNoteMode(true)}
                        />
                        <IconBarButton
                            tint="amber"
                            icon={<PauseCircle className="w-5 h-5" />}
                            label="Hold"
                            ariaLabel="Put on Hold"
                            onClick={() => {
                                onHold();
                                onClose();
                            }}
                        />
                        <IconBarButton
                            tint="red"
                            icon={<Trash2 className="w-5 h-5" />}
                            label="Delete"
                            ariaLabel="Delete Appointment"
                            labelDanger
                            onClick={() => {
                                onDelete();
                                onClose();
                            }}
                        />
                    </div>

                    {/* Note inline expansion — reveals below the icon bar when Note tapped */}
                    {chipNoteMode && (
                        <div className="px-4 py-3 space-y-2 mt-2 border-t border-[var(--color-border)]">
                            {/* Existing notes list */}
                            {notes.length > 0 && (
                                <div className="space-y-1">
                                    {notes.map((note, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg px-3 py-1.5"
                                        >
                                            {editingIndex === index ? (
                                                <input
                                                    ref={editInputRef}
                                                    type="text"
                                                    value={editingText}
                                                    onChange={(e) => setEditingText(e.target.value)}
                                                    onBlur={commitEdit}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            commitEdit();
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEdit();
                                                        }
                                                    }}
                                                    className="flex-1 text-sm text-[var(--color-text-primary)] bg-white dark:bg-amber-900/50 rounded px-2 py-0.5 border border-amber-300 dark:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                                />
                                            ) : (
                                                <button
                                                    onClick={() => startEditing(index)}
                                                    className="flex-1 flex items-center gap-1.5 text-left min-w-0 group"
                                                >
                                                    <span className="text-sm text-[var(--color-text-primary)] truncate">{note}</span>
                                                    <Pencil className="w-3 h-3 text-amber-400 dark:text-amber-600 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => removeNote(index)}
                                                className="p-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors shrink-0"
                                                aria-label={`Remove note: ${note}`}
                                            >
                                                <X className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add note input */}
                            {notes.length < MAX_CHIP_NOTES ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={newNoteText}
                                        onChange={(e) => setNewNoteText(e.target.value)}
                                        placeholder="e.g., Call 15 min before"
                                        autoFocus
                                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (newNoteText.trim()) {
                                                    addNote();
                                                } else {
                                                    saveNotes();
                                                }
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={addNote}
                                        disabled={!newNoteText.trim()}
                                        className="p-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Add note"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
                                    Max {MAX_CHIP_NOTES} notes reached
                                </p>
                            )}

                            {/* Color picker */}
                            <div className="flex items-center gap-2 px-1">
                                <span className="text-xs text-[var(--color-text-secondary)]">Color</span>
                                <div className="flex gap-1.5">
                                    {CHIP_NOTE_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => setSelectedColor(color)}
                                            className={`w-5 h-5 rounded-full border-2 transition-transform ${
                                                selectedColor === color
                                                    ? "scale-110 border-[var(--color-text-primary)]"
                                                    : "border-transparent hover:scale-105"
                                            }`}
                                            style={{ backgroundColor: CHIP_NOTE_SWATCH_HEX[color] }}
                                            title={color}
                                            aria-label={`${color} note color`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Remove from all */}
                            {!isPersonal && hasPatientNotes && (
                                <div className="flex pt-1">
                                    <button
                                        onClick={handleRemoveFromAll}
                                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                            confirmingRemoveAll
                                                ? "bg-red-500 text-white hover:bg-red-600"
                                                : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
                                        }`}
                                    >
                                        {confirmingRemoveAll ? "Confirm?" : "Remove from all"}
                                    </button>
                                </div>
                            )}

                            {/* Apply to all + Save */}
                            <div className="flex items-center justify-between gap-2 pt-1">
                                {!isPersonal && (
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={applyToAll}
                                            onChange={(e) => {
                                                setApplyToAll(e.target.checked);
                                                setConfirmingRemoveAll(false);
                                            }}
                                            className="w-4 h-4 rounded border-[var(--color-border)] text-amber-500 focus:ring-amber-400 accent-amber-500"
                                        />
                                        <span className="text-sm text-[var(--color-text-secondary)]">Apply to all</span>
                                    </label>
                                )}
                                <button
                                    onClick={saveNotes}
                                    className="ml-auto px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
                                >
                                    Save
                                </button>
                            </div>

                            {effectiveNotes.length > 0 && (
                                <p className="text-[11px] text-[var(--color-text-tertiary)] px-1 italic">
                                    {noteFromPatient ? "Notes from patient record" : "Notes on this appointment"}
                                </p>
                            )}
                        </div>
                    )}
```

**Key difference from the old code:** the note editor is no longer nested inside a `chipNoteMode ? A : B` ternary that swaps the Quick Note button in and out. The icon bar is always rendered; the note editor is a separate sibling block that conditionally renders below the bar when `chipNoteMode` is true.

- [ ] **Step 6.3: Run the build**

```bash
cd pt-scheduler && npm run build
```
Expected: build succeeds. If TypeScript complains that `notePreview` is now unused, delete its declaration from the function body (it was only used by the old Quick Note button preview).

- [ ] **Step 6.4: Handle `notePreview` if flagged**

If the build errors with `'notePreview' is declared but its value is never read`, find and delete these lines inside `AppointmentActionSheet`:

```tsx
    const noteCount = effectiveNotes.length;
    const notePreview = noteCount > 0
        ? (noteCount === 1 ? effectiveNotes[0] : `${noteCount} notes`)
        : "";
```

Replace with:

```tsx
    const noteCount = effectiveNotes.length;
```

(`noteCount` is still used by the IconBarButton label ternary.)

Re-run the build.

- [ ] **Step 6.5: Visual check**

- Icon bar renders as 6 evenly spaced cells below the divider
- Each icon has a visible label beneath it
- Tapping Edit opens the detail modal
- Tapping Move triggers move flow
- Tapping Copy triggers copy flow
- Tapping Note expands the note editor below the icon bar (icon bar stays visible above)
- Adding / editing / removing / color-picking / saving a note all still work
- Tapping Hold puts the appointment on hold (verify it moves to the sidebar's on-hold section)
- Tapping Delete prompts/completes delete per existing flow
- On desktop, hovering any icon shows the full label as a native tooltip

- [ ] **Step 6.6: Commit**

```bash
cd "C:\Users\Isom\Desktop\Projects\Scheduler app"
git add pt-scheduler/src/components/AppointmentActionSheet.tsx
git commit -m "refactor: collapse management actions into 6-icon action bar"
```

---

## Task 7: Final verification and deploy

**Files:** none modified

**Context:** Walk through the worst-case sheet and ship.

- [ ] **Step 7.1: Run the full build one more time**

```bash
cd pt-scheduler && npm run build
```
Expected: success, no warnings related to `AppointmentActionSheet.tsx`.

- [ ] **Step 7.2: Manual walk-through on mobile viewport**

`npm run dev`, open Chrome DevTools device toolbar at iPhone 12 Pro (390×844), then:

- Tap a chip whose patient has a primary phone, 2 alternate contacts, an address, and at least one chip note. The entire sheet should be visible without scrolling.
- Tap each of the 3 mini buttons on each contact row (Call / Text / Copy).
- Tap Navigate and verify maps opens.
- Tap Copy on the address row and verify the clipboard.
- Tap each of the 6 icon bar buttons and verify the downstream flow.
- Tap Note, expand, add a note, save, reopen, edit it, remove it, try "apply to all" and "remove from all" for a non-personal appointment.
- Open a personal event appointment (no patient) and confirm the contact section is skipped and the icon bar still works.
- Repeat at 320×568 (iPhone SE) to stress the narrowest viewport. Confirm rows don't overflow — names should truncate gracefully if needed.

- [ ] **Step 7.3: Deploy per project rule**

Follow the project CLAUDE.md deploy sequence:

```bash
cd pt-scheduler && npm run build
cd ..
git push origin main
cd pt-scheduler && vercel --prod
```

If any step fails, stop and fix — do not skip.

---

## Self-review notes (already applied inline)

- **Spec coverage:** contact rows (Tasks 1-4), icon action bar (Tasks 5-6), Note inline expansion below the bar (Task 6), header/frame unchanged (no task needed), cleanup of dead on-hold guard (Task 6 absorbs it — the Hold button always renders in the bar, and the old `appointment.status !== "on-hold"` conditional is deleted along with the rest of the stacked buttons). ContactRow and IconBarButton extracted as private helpers (Tasks 1, 5).
- **Placeholder scan:** every code block is concrete, no TBDs, no "add error handling later" hand-waves.
- **Type consistency:** `ContactRowAction` / `ContactRowProps` / `IconBarButtonProps` are defined in Tasks 1 and 5 and consumed in Tasks 2-6 with matching names. The `copiedKey` prop is passed through from the parent's existing state — no new state introduced.
- **Handler signatures:** `onViewEdit`, `onMove`, `onCopy`, `onHold`, `onDelete`, `onNavigate`, `onChipNote`, `onPatientChipNote`, `onClose` are consumed identically to today. `SchedulePage.tsx` is not touched.
- **Note `chipNoteMode` subtlety:** the current file swaps the Quick Note button in and out with the note editor via a ternary. The refactor turns this into two separate JSX blocks — icon bar always renders, note editor renders conditionally below it. This is called out explicitly in Task 6 Step 6.2.
