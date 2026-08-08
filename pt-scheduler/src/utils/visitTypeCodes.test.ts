import { describe, it, expect } from "vitest";
import {
    normalizeVisitType,
    parseVisitTypeAndName,
    isPlausibleVisitTypeCode,
    isValidVisitTypeColor,
    validateNewVisitTypeCode,
    validateVisitTypeLabel,
} from "./visitTypeCodes";

describe("normalizeVisitType", () => {
    it("strips brackets", () => {
        expect(normalizeVisitType("[PT 11]")).toBe("PT11");
    });

    it("strips the 'Visit Type:' label", () => {
        expect(normalizeVisitType("Visit Type: PT11")).toBe("PT11");
    });

    it("strips separators between letters and digits", () => {
        expect(normalizeVisitType("pt-11")).toBe("PT11");
        expect(normalizeVisitType("PT 05")).toBe("PT05");
    });

    it("keeps NOMNC (which the scheduling.ts copy silently dropped)", () => {
        expect(normalizeVisitType("nomnc")).toBe("NOMNC");
    });

    it("collapses keyword codes", () => {
        expect(normalizeVisitType("RE EVAL")).toBe("REEVAL");
        expect(normalizeVisitType("eval")).toBe("EVAL");
    });

    it("returns undefined for empty input", () => {
        expect(normalizeVisitType(undefined)).toBeUndefined();
        expect(normalizeVisitType("   ")).toBeUndefined();
    });

    it("falls through to uppercase for anything else", () => {
        expect(normalizeVisitType("smith, john")).toBe("SMITH, JOHN");
    });
});

describe("parseVisitTypeAndName", () => {
    it("splits a code prefix off the name", () => {
        expect(parseVisitTypeAndName({ rawName: "PT11 - Jane Doe" })).toEqual({
            rawName: "Jane Doe",
            visitType: "PT11",
        });
    });

    it("strips the code from the name when a visit type is supplied", () => {
        expect(
            parseVisitTypeAndName({ rawName: "PT11 Jane Doe", visitType: "[PT 11]" })
        ).toEqual({ rawName: "Jane Doe", visitType: "PT11" });
    });

    it("leaves a plain name alone", () => {
        expect(parseVisitTypeAndName({ rawName: "Jane Doe" })).toEqual({
            rawName: "Jane Doe",
        });
    });
});

describe("isPlausibleVisitTypeCode", () => {
    it("accepts real codes", () => {
        expect(isPlausibleVisitTypeCode("PT26")).toBe(true);
        expect(isPlausibleVisitTypeCode("OT1")).toBe(true);
        expect(isPlausibleVisitTypeCode("NOMNC")).toBe(true);
    });

    it("rejects garbage OCR reads", () => {
        expect(isPlausibleVisitTypeCode("")).toBe(false);
        expect(isPlausibleVisitTypeCode(null)).toBe(false);
        expect(isPlausibleVisitTypeCode(undefined)).toBe(false);
        expect(isPlausibleVisitTypeCode("SMITH, JOHN")).toBe(false);
        expect(isPlausibleVisitTypeCode("12")).toBe(false);
        expect(isPlausibleVisitTypeCode("PT 26")).toBe(false);
        expect(isPlausibleVisitTypeCode("P")).toBe(false);
        expect(isPlausibleVisitTypeCode("PT1234567890")).toBe(false);
    });
});

describe("isValidVisitTypeColor", () => {
    it("accepts #rrggbb only", () => {
        expect(isValidVisitTypeColor("#039be5")).toBe(true);
        expect(isValidVisitTypeColor("#039BE5")).toBe(true);
        expect(isValidVisitTypeColor("red")).toBe(false);
        expect(isValidVisitTypeColor("#abc")).toBe(false);
        expect(isValidVisitTypeColor("")).toBe(false);
    });
});

describe("validateNewVisitTypeCode", () => {
    it("uppercases and accepts a new code", () => {
        expect(validateNewVisitTypeCode("pt26", { existingCodes: ["PT11"] })).toEqual({
            ok: true,
            code: "PT26",
        });
    });

    it("rejects a malformed code", () => {
        const result = validateNewVisitTypeCode("PT 26", { existingCodes: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("format");
    });

    it("rejects an empty code", () => {
        const result = validateNewVisitTypeCode("  ", { existingCodes: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("empty");
    });

    it("rejects a plain duplicate", () => {
        const result = validateNewVisitTypeCode("PT26", { existingCodes: ["PT26"] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe("duplicate");
            expect(result.error.message).toContain("PT26");
        }
    });

    it("returns the built-in-hidden variant for a hidden built-in", () => {
        const result = validateNewVisitTypeCode("PT18", {
            existingCodes: ["PT18"],
            hiddenCodes: ["PT18"],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe("builtInHidden");
            expect(result.error.message).toContain("unhide it instead");
        }
    });

    it("treats a visible built-in as an ordinary duplicate", () => {
        const result = validateNewVisitTypeCode("PT18", { existingCodes: ["PT18"] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("duplicate");
    });
});

describe("validateVisitTypeLabel", () => {
    it("trims and accepts", () => {
        expect(validateVisitTypeLabel("  Regular Visit ")).toEqual({
            ok: true,
            label: "Regular Visit",
        });
    });

    it("rejects empty and overlong labels", () => {
        expect(validateVisitTypeLabel("")).toMatchObject({ ok: false });
        expect(validateVisitTypeLabel("x".repeat(41))).toMatchObject({ ok: false });
    });
});
