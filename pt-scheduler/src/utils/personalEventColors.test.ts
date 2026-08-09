import { describe, it, expect } from "vitest";
import {
    PERSONAL_CATEGORY_CONFIGS,
    getPersonalCategoryForeground,
    getPersonalCategoryConfig,
} from "./personalEventColors";
import { contrastRatio } from "./visitTypeColors";

const AA_NORMAL = 4.5;

describe("getPersonalCategoryForeground", () => {
    it("clears WCAG AA over every category colour", () => {
        for (const config of PERSONAL_CATEGORY_CONFIGS) {
            const fg = getPersonalCategoryForeground(config.code);
            const ratio = contrastRatio(config.bg, fg);
            expect(
                ratio,
                `${config.code} ${config.bg} → ${fg} = ${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(AA_NORMAL);
        }
    });

    it("covers the marginal light categories specifically", () => {
        // `other` (#bcaaa4) and `errand` (#9e9d24) are the two light enough to
        // have been unreadable under the old hardcoded white.
        for (const code of ["other", "errand"]) {
            const { bg } = getPersonalCategoryConfig(code);
            expect(
                contrastRatio(bg, getPersonalCategoryForeground(code)),
                code
            ).toBeGreaterThanOrEqual(AA_NORMAL);
        }
    });

    it("falls back to the default category for unknown or missing input", () => {
        const fallback = getPersonalCategoryForeground("other");
        expect(getPersonalCategoryForeground(undefined)).toBe(fallback);
        expect(getPersonalCategoryForeground("nonsense")).toBe(fallback);
    });

    it("returns a literal hex, not a var() expression", () => {
        // Personal categories bypass the --vt-* custom properties entirely.
        for (const config of PERSONAL_CATEGORY_CONFIGS) {
            expect(getPersonalCategoryForeground(config.code)).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});
