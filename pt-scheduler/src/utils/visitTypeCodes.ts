import { BUILT_IN_VISIT_TYPE_CODES } from "../types";

/**
 * Shape a visit type code must have to be storable on an appointment or
 * configurable in Settings. The leading letter keeps it usable as a CSS
 * custom-property suffix and avoids colliding with the `--vt-grad--none`
 * sentinel used for the unspecified type.
 */
export const VISIT_TYPE_CODE_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

/** Colors are stored as lowercase `#rrggbb`. */
export const VISIT_TYPE_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

export const MAX_VISIT_TYPE_LABEL_LENGTH = 40;

/**
 * Normalize visit type strings to a consistent format.
 *
 * Extracted verbatim from ScanPage so the scan path, the sheet parser and the
 * Settings form all agree on what a code looks like.
 */
export function normalizeVisitType(value?: string): string | undefined {
    const raw = (value ?? "").trim();
    if (!raw) {
        return undefined;
    }

    const cleaned = raw
        .replace(/^[[({<]+|[\])}>]+$/g, "")
        .replace(/^visit\s*type\s*[:-]?\s*/i, "")
        .replace(/[–—]/g, "-")
        .replace(/^[\s:;-]+|[\s:;-]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return undefined;
    }

    const alphaNumeric = cleaned.match(/^([A-Za-z]{1,6})\s*[-]?\s*(\d{1,3})$/);
    if (alphaNumeric) {
        return `${alphaNumeric[1].toUpperCase()}${alphaNumeric[2]}`;
    }

    const keyword = cleaned.match(/^(EVAL|SOC|DC|ROC|RE[-\s]?EVAL|NOMNC)$/i);
    if (keyword) {
        return keyword[1].toUpperCase().replace(/[-\s]/g, "");
    }

    return cleaned.toUpperCase();
}

export const VISIT_TYPE_PREFIX_REGEX =
    /^([A-Za-z]{1,6}\s*[-]?\s*\d{1,3}|EVAL|SOC|DC|ROC|RE[-\s]?EVAL|NOMNC)\s*(?:[-:–—]\s*|\s+)(.+)$/i;

export function parseVisitTypeAndName(input: {
    rawName: string;
    visitType?: string;
}): { rawName: string; visitType?: string } {
    const nameValue = (input.rawName ?? "").replace(/\s+/g, " ").trim();
    const visitTypeValue = normalizeVisitType(input.visitType);

    if (visitTypeValue) {
        const withoutVisitType = nameValue
            .replace(
                /^([A-Za-z]{1,6}\s*[-]?\s*\d{1,3}|EVAL|SOC|DC|ROC|RE[-\s]?EVAL|NOMNC)\s*(?:[-:–—]\s*)?/i,
                ""
            )
            .trim();
        return {
            rawName: withoutVisitType || nameValue,
            visitType: visitTypeValue,
        };
    }

    const match = nameValue.match(VISIT_TYPE_PREFIX_REGEX);
    if (match) {
        const normalizedVisitType = normalizeVisitType(match[1]);
        return {
            rawName: match[2].trim() || nameValue,
            visitType: normalizedVisitType,
        };
    }

    return { rawName: nameValue };
}

/**
 * Load-bearing shape guard for the scan path. `normalizeVisitType` falls
 * through to `cleaned.toUpperCase()`, so a garbage OCR read such as
 * "SMITH, JOHN" would otherwise land on the appointment as a visit type.
 */
export function isPlausibleVisitTypeCode(value: string | null | undefined): value is string {
    return !!value && VISIT_TYPE_CODE_REGEX.test(value);
}

export function isValidVisitTypeColor(value: string | null | undefined): value is string {
    return !!value && VISIT_TYPE_COLOR_REGEX.test(value);
}

export type NewVisitTypeCodeError =
    | { kind: "empty"; message: string }
    | { kind: "format"; message: string }
    | { kind: "builtInHidden"; message: string; code: string }
    | { kind: "duplicate"; message: string; code: string };

export interface ValidateNewVisitTypeCodeOptions {
    /** Every code currently in the effective registry, hidden ones included. */
    existingCodes: readonly string[];
    /** Codes currently hidden from the dropdown. */
    hiddenCodes?: readonly string[];
}

/**
 * Validate a user-entered code for a new visit type. Returns the normalized
 * (uppercased) code, or an error describing why it was rejected.
 *
 * Silently shadowing a hidden built-in is the subtle bug this guards against,
 * so a collision with a hidden built-in gets its own error kind and copy.
 */
export function validateNewVisitTypeCode(
    input: string,
    { existingCodes, hiddenCodes = [] }: ValidateNewVisitTypeCodeOptions
): { ok: true; code: string } | { ok: false; error: NewVisitTypeCodeError } {
    const code = (input ?? "").trim().toUpperCase();

    if (!code) {
        return { ok: false, error: { kind: "empty", message: "Enter a code." } };
    }

    if (!VISIT_TYPE_CODE_REGEX.test(code)) {
        return {
            ok: false,
            error: {
                kind: "format",
                message: "Codes are 2–10 characters: a letter, then letters or digits (e.g. PT26).",
            },
        };
    }

    if (existingCodes.includes(code)) {
        const isBuiltIn = (BUILT_IN_VISIT_TYPE_CODES as readonly string[]).includes(code);
        if (isBuiltIn && hiddenCodes.includes(code)) {
            return {
                ok: false,
                error: {
                    kind: "builtInHidden",
                    code,
                    message: `${code} is a built-in type. It's currently hidden — unhide it instead.`,
                },
            };
        }
        return {
            ok: false,
            error: { kind: "duplicate", code, message: `${code} already exists.` },
        };
    }

    return { ok: true, code };
}

export function validateVisitTypeLabel(input: string): { ok: true; label: string } | { ok: false; message: string } {
    const label = (input ?? "").trim();
    if (!label) {
        return { ok: false, message: "Enter a description." };
    }
    if (label.length > MAX_VISIT_TYPE_LABEL_LENGTH) {
        return { ok: false, message: `Keep it to ${MAX_VISIT_TYPE_LABEL_LENGTH} characters or fewer.` };
    }
    return { ok: true, label };
}
