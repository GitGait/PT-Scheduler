import { useSyncExternalStore } from "react";
import type { VisitType } from "../types";
import { VISIT_TYPE_COLOR_REGEX } from "./visitTypeCodes";

export interface VisitTypeConfig {
    code: VisitType;
    label: string;
    bg: string;
    gradient: string;
    /** Hidden from the dropdown only — still colours existing chips. */
    hidden?: boolean;
}

export const DEFAULT_VISIT_TYPE_CONFIG: VisitTypeConfig = {
    code: null,
    label: "Unspecified",
    bg: "#b0bec5",
    gradient: "linear-gradient(135deg, #b0bec5 0%, #90a4ae 100%)",
};

/**
 * The visit types compiled into the bundle. Users can rename, recolor and hide
 * these from Settings, but they are never stored in Dexie and never removable:
 * PT18/PT19 drive auto-discharge and NOMNC drives scan routing, so the codes
 * are behavioural contracts — never remove one.
 *
 * These gradients are also the `var()` fallbacks used before Dexie hydrates,
 * so a fresh device's first paint is pixel-identical to the built-in scheme.
 */
export const BUILT_IN_VISIT_TYPE_CONFIGS: readonly VisitTypeConfig[] = Object.freeze([
    {
        code: "PT01",
        label: "PT Evaluation",
        bg: "#00897b",
        gradient: "linear-gradient(135deg, #00897b 0%, #00695c 100%)",
    },
    {
        code: "PT00",
        label: "OASIS Evaluation",
        bg: "#8e24aa",
        gradient: "linear-gradient(135deg, #8e24aa 0%, #6a1b9a 100%)",
    },
    {
        code: "PT02",
        label: "OASIS Recertification",
        bg: "#5c6bc0",
        gradient: "linear-gradient(135deg, #5c6bc0 0%, #3f51b5 100%)",
    },
    {
        code: "PT18",
        label: "OASIS Discharge",
        bg: "#fb8c00",
        gradient: "linear-gradient(135deg, #fb8c00 0%, #ef6c00 100%)",
    },
    {
        code: "PT19",
        label: "PT Discharge",
        bg: "#e53935",
        gradient: "linear-gradient(135deg, #e53935 0%, #c62828 100%)",
    },
    {
        code: "PT11",
        label: "Regular Visit",
        bg: "#039be5",
        gradient: "linear-gradient(135deg, #039be5 0%, #0288d1 100%)",
    },
    {
        code: "PT05",
        label: "ROC/Recert",
        bg: "#d81b60",
        gradient: "linear-gradient(135deg, #d81b60 0%, #ad1457 100%)",
    },
    {
        code: "PT06",
        label: "Recert",
        bg: "#ff6d00",
        gradient: "linear-gradient(135deg, #ff6d00 0%, #e65100 100%)",
    },
    {
        code: "PT10",
        label: "Supervisory Visit",
        bg: "#ffab00",
        gradient: "linear-gradient(135deg, #ffab00 0%, #ff8f00 100%)",
    },
    {
        code: "PT15",
        label: "Resumption of Care",
        bg: "#00bcd4",
        gradient: "linear-gradient(135deg, #00bcd4 0%, #0097a7 100%)",
    },
    {
        code: "NOMNC",
        label: "NOMNC",
        bg: "#795548",
        gradient: "linear-gradient(135deg, #795548 0%, #5d4037 100%)",
    },
    {
        code: "PT33",
        label: "PT Reassessment",
        bg: "#607d8b",
        gradient: "linear-gradient(135deg, #607d8b 0%, #455a64 100%)",
    },
] as VisitTypeConfig[]);

const BUILT_IN_BY_CODE = new Map<VisitType, VisitTypeConfig>(
    BUILT_IN_VISIT_TYPE_CONFIGS.map((config) => [config.code, config])
);

// =============================================================================
// Colour maths
// =============================================================================

/** Only values matching this exact shape are ever written into a CSS custom property. */
const SAFE_GRADIENT_REGEX = /^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/i;

function darkenHex(hex: string, amount: number): string {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const scale = (channel: number) =>
        Math.max(0, Math.min(255, Math.round(channel * (1 - amount))))
            .toString(16)
            .padStart(2, "0");
    return `#${scale(r)}${scale(g)}${scale(b)}`;
}

/**
 * Derive a two-stop gradient from a user-chosen background colour. Built-ins
 * whose `bg` is untouched keep their hand-picked gradient pair instead.
 */
export function deriveGradient(bg: string): string {
    if (!VISIT_TYPE_COLOR_REGEX.test(bg)) {
        return DEFAULT_VISIT_TYPE_CONFIG.gradient;
    }
    const normalized = bg.toLowerCase();
    return `linear-gradient(135deg, ${normalized} 0%, ${darkenHex(normalized, 0.18)} 100%)`;
}

// =============================================================================
// Swatch palette
// =============================================================================

export interface VisitTypeHue {
    /** Display name — used for aria-labels and as the open-family key. */
    name: string;
    /** Four steps, lightest first. `shades[1]` is the family's representative swatch. */
    shades: readonly [string, string, string, string];
}

/**
 * The curated palette offered in Settings, grouped so a user can pick "the same
 * blue, but darker" in one tap.
 *
 * Chips render hardcoded white text, and nothing in the app computes a readable
 * foreground, so the light end of every family is capped at roughly the
 * lightness of the lightest colour already shipping (#ffab00 / #00bcd4). Never
 * add a step lighter than these — it would make white chip text unreadable.
 *
 * Every built-in `bg` appears here verbatim, so the colour a type already has is
 * always findable in the grid. `visitTypeColors.test.ts` locks both invariants.
 */
export const VISIT_TYPE_HUES: readonly VisitTypeHue[] = Object.freeze([
    { name: "Red", shades: ["#ef5350", "#e53935", "#c62828", "#b71c1c"] },
    { name: "Pink", shades: ["#ec407a", "#d81b60", "#ad1457", "#880e4f"] },
    { name: "Purple", shades: ["#ab47bc", "#8e24aa", "#6a1b9a", "#4a148c"] },
    { name: "Deep Purple", shades: ["#7e57c2", "#5e35b1", "#4527a0", "#311b92"] },
    { name: "Indigo", shades: ["#5c6bc0", "#3949ab", "#283593", "#1a237e"] },
    { name: "Blue", shades: ["#42a5f5", "#1e88e5", "#1565c0", "#0d47a1"] },
    { name: "Light Blue", shades: ["#29b6f6", "#039be5", "#0277bd", "#01579b"] },
    { name: "Cyan", shades: ["#26c6da", "#00bcd4", "#0097a7", "#006064"] },
    { name: "Teal", shades: ["#26a69a", "#00897b", "#00695c", "#004d40"] },
    { name: "Green", shades: ["#4caf50", "#43a047", "#2e7d32", "#1b5e20"] },
    { name: "Amber", shades: ["#ffab00", "#ffa000", "#ff8f00", "#ff6f00"] },
    { name: "Orange", shades: ["#fb8c00", "#ff6d00", "#ef6c00", "#e65100"] },
    { name: "Deep Orange", shades: ["#ff7043", "#f4511e", "#d84315", "#bf360c"] },
    { name: "Brown", shades: ["#8d6e63", "#795548", "#5d4037", "#3e2723"] },
    { name: "Blue Grey", shades: ["#78909c", "#607d8b", "#546e7a", "#37474f"] },
    { name: "Grey", shades: ["#9e9e9e", "#757575", "#616161", "#212121"] },
] as VisitTypeHue[]);

/** The family a colour belongs to, or undefined for a hex outside the palette. */
export function findVisitTypeHue(bg: string): VisitTypeHue | undefined {
    const normalized = bg.toLowerCase();
    return VISIT_TYPE_HUES.find((hue) => hue.shades.includes(normalized));
}

// =============================================================================
// Registry — the effective list, swapped in by visitTypeStore
// =============================================================================

let registry: readonly VisitTypeConfig[] = BUILT_IN_VISIT_TYPE_CONFIGS;
let registryByCode = new Map<VisitType, VisitTypeConfig>(BUILT_IN_BY_CODE);
let cssText = buildVisitTypeCssText(BUILT_IN_VISIT_TYPE_CONFIGS);

const listeners = new Set<() => void>();

export function setVisitTypeRegistry(configs: readonly VisitTypeConfig[]): void {
    registry = configs;
    registryByCode = new Map(configs.map((config) => [config.code, config]));
    cssText = buildVisitTypeCssText(configs);
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeVisitTypes(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getVisitTypeRegistry(): readonly VisitTypeConfig[] {
    return registry;
}

export function getVisitTypeCssText(): string {
    return cssText;
}

/**
 * The effective visit type list, for callers that need labels or list
 * membership (which CSS custom properties cannot carry). SchedulePage never
 * uses this — its chips repaint via the custom properties alone.
 */
export function useVisitTypes(): readonly VisitTypeConfig[] {
    return useSyncExternalStore(subscribeVisitTypes, getVisitTypeRegistry, getVisitTypeRegistry);
}

// =============================================================================
// CSS custom properties
// =============================================================================

/** `PT11` → `--vt-grad-PT11`; the unspecified type → `--vt-grad--none`. */
export function cssVarNameForCode(code: VisitType, kind: "grad" | "bg" = "grad"): string {
    return `--vt-${kind}-${code ?? "-none"}`;
}

/**
 * Build the `:root { … }` block.
 *
 * Every value is re-validated here. A malformed custom property makes
 * `background: var(--vt-grad-PT26, …)` *invalid at computed-value time*, and
 * CSS then applies `unset` rather than the `var()` fallback — the chip would
 * render transparent, not gray. So an entry that fails validation is omitted
 * entirely, which lets the compile-time fallback do its job.
 */
export function buildVisitTypeCssText(configs: readonly VisitTypeConfig[]): string {
    const lines: string[] = [];
    for (const config of configs) {
        if (!VISIT_TYPE_COLOR_REGEX.test(config.bg ?? "")) {
            continue;
        }
        const bg = config.bg.toLowerCase();
        const gradient = SAFE_GRADIENT_REGEX.test(config.gradient ?? "")
            ? config.gradient.toLowerCase()
            : deriveGradient(bg);
        lines.push(`  ${cssVarNameForCode(config.code, "bg")}: ${bg};`);
        lines.push(`  ${cssVarNameForCode(config.code, "grad")}: ${gradient};`);
    }
    return `:root {\n${lines.join("\n")}\n}`;
}

// =============================================================================
// Accessors
// =============================================================================

function builtInFallback(visitType: VisitType | undefined): VisitTypeConfig {
    return BUILT_IN_BY_CODE.get(visitType ?? null) ?? DEFAULT_VISIT_TYPE_CONFIG;
}

/**
 * Returns a `var()` expression, not a literal colour. The browser repaints
 * chips when the custom property changes, so callers inside render (notably
 * SchedulePage) need no subscription. The fallback is the compile-time
 * built-in, so the first paint before hydration matches the built-in scheme.
 */
export function getVisitTypeColor(visitType: VisitType | undefined): string {
    return `var(${cssVarNameForCode(visitType ?? null, "bg")}, ${builtInFallback(visitType).bg})`;
}

export function getVisitTypeGradient(visitType: VisitType | undefined): string {
    return `var(${cssVarNameForCode(visitType ?? null, "grad")}, ${builtInFallback(visitType).gradient})`;
}

/** Text can't live in a CSS variable, so these read the registry directly. */
export function getVisitTypeLabel(visitType: VisitType | undefined): string {
    return registryByCode.get(visitType ?? null)?.label ?? DEFAULT_VISIT_TYPE_CONFIG.label;
}
