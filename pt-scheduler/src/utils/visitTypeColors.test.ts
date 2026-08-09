import { describe, it, expect, afterEach } from "vitest";
import {
    BUILT_IN_VISIT_TYPE_CONFIGS,
    DEFAULT_VISIT_TYPE_CONFIG,
    buildVisitTypeCssText,
    cssVarNameForCode,
    deriveGradient,
    getVisitTypeColor,
    getVisitTypeCssText,
    getVisitTypeGradient,
    getVisitTypeLabel,
    setVisitTypeRegistry,
    VISIT_TYPE_HUES,
    findVisitTypeHue,
    contrastRatio,
    relativeLuminance,
    type VisitTypeConfig,
} from "./visitTypeColors";
import { VISIT_TYPE_COLOR_REGEX } from "./visitTypeCodes";

const PT11 = BUILT_IN_VISIT_TYPE_CONFIGS.find((c) => c.code === "PT11")!;

afterEach(() => {
    setVisitTypeRegistry(BUILT_IN_VISIT_TYPE_CONFIGS);
});

describe("cssVarNameForCode", () => {
    it("names gradient and background vars per code", () => {
        expect(cssVarNameForCode("PT11")).toBe("--vt-grad-PT11");
        expect(cssVarNameForCode("PT11", "bg")).toBe("--vt-bg-PT11");
    });

    it("uses a sentinel for the unspecified type", () => {
        expect(cssVarNameForCode(null)).toBe("--vt-grad--none");
    });
});

describe("accessors", () => {
    it("returns a var() whose fallback is the exact current built-in gradient", () => {
        // Guards the no-flash requirement: the first paint before Dexie
        // hydrates must be pixel-identical to the built-in scheme.
        expect(getVisitTypeGradient("PT11")).toBe(
            `var(--vt-grad-PT11, linear-gradient(135deg, #039be5 0%, #0288d1 100%))`
        );
        expect(getVisitTypeColor("PT11")).toBe("var(--vt-bg-PT11, #039be5)");
    });

    it("falls back to gray for an unconfigured code", () => {
        expect(getVisitTypeGradient("PT26")).toBe(
            `var(--vt-grad-PT26, ${DEFAULT_VISIT_TYPE_CONFIG.gradient})`
        );
        expect(getVisitTypeColor("PT26")).toBe(
            `var(--vt-bg-PT26, ${DEFAULT_VISIT_TYPE_CONFIG.bg})`
        );
    });

    it("falls back to gray for the unspecified type", () => {
        expect(getVisitTypeGradient(null)).toBe(
            `var(--vt-grad--none, ${DEFAULT_VISIT_TYPE_CONFIG.gradient})`
        );
    });

    it("reads labels from the registry, not a CSS var", () => {
        expect(getVisitTypeLabel("PT11")).toBe("Regular Visit");
        setVisitTypeRegistry([{ ...PT11, label: "My Visit" }]);
        expect(getVisitTypeLabel("PT11")).toBe("My Visit");
        expect(getVisitTypeLabel("PT26")).toBe(DEFAULT_VISIT_TYPE_CONFIG.label);
    });
});

describe("deriveGradient", () => {
    it("yields a valid two-stop gradient darker than the source", () => {
        expect(deriveGradient("#039be5")).toBe(
            "linear-gradient(135deg, #039be5 0%, #027fbc 100%)"
        );
    });

    it("falls back to the default gradient for a malformed colour", () => {
        expect(deriveGradient("red")).toBe(DEFAULT_VISIT_TYPE_CONFIG.gradient);
    });
});

describe("VISIT_TYPE_HUES", () => {
    const allShades = VISIT_TYPE_HUES.flatMap((hue) => hue.shades);

    it("offers four lowercase hex steps per family", () => {
        for (const hue of VISIT_TYPE_HUES) {
            expect(hue.shades).toHaveLength(4);
            for (const shade of hue.shades) {
                expect(shade).toMatch(VISIT_TYPE_COLOR_REGEX);
                expect(shade).toBe(shade.toLowerCase());
            }
        }
    });

    it("never repeats a colour across families", () => {
        expect(new Set(allShades).size).toBe(allShades.length);
    });

    it("never repeats a family name", () => {
        const names = VISIT_TYPE_HUES.map((hue) => hue.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("contains every built-in colour, so an existing choice stays findable", () => {
        for (const config of BUILT_IN_VISIT_TYPE_CONFIGS) {
            expect(allShades).toContain(config.bg.toLowerCase());
        }
    });

    it("never gets lighter than the current ceiling, which white text depends on", () => {
        // Chips render white text, so a swatch lighter than today's lightest
        // (#ffab00, already only 1.9:1) would be worse than anything shipping.
        // The palette comment has always claimed this was enforced — now it is.
        const ceiling = relativeLuminance("#ffab00");
        for (const hue of VISIT_TYPE_HUES) {
            for (const shade of hue.shades) {
                expect(
                    relativeLuminance(shade),
                    `${hue.name} ${shade} is lighter than the #ffab00 ceiling`
                ).toBeLessThanOrEqual(ceiling);
            }
        }
    });

    it("keeps every built-in within that same ceiling", () => {
        const ceiling = relativeLuminance("#ffab00");
        for (const config of [...BUILT_IN_VISIT_TYPE_CONFIGS, DEFAULT_VISIT_TYPE_CONFIG]) {
            expect(relativeLuminance(config.bg), config.code ?? "default").toBeLessThanOrEqual(
                ceiling
            );
        }
    });
});


describe("relativeLuminance / contrastRatio", () => {
    it("anchors at the WCAG reference values", () => {
        expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
        expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
        expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    });

    it("is order-independent", () => {
        expect(contrastRatio("#ffab00", "#2e1f00")).toBeCloseTo(
            contrastRatio("#2e1f00", "#ffab00"),
            10
        );
    });

    it("records what white chip text actually costs at the light end", () => {
        // Chips render white text by preference. Amber is the worst case in the
        // palette; this is documented rather than fixed, and is why the
        // lightness cap above exists.
        expect(contrastRatio("#ffab00", "#ffffff")).toBeLessThan(2);
    });
});

describe("findVisitTypeHue", () => {
    it("finds the family for any shade, case-insensitively", () => {
        expect(findVisitTypeHue("#039be5")?.name).toBe("Light Blue");
        expect(findVisitTypeHue("#01579B")?.name).toBe("Light Blue");
    });

    it("returns undefined for a colour outside the palette", () => {
        expect(findVisitTypeHue("#123456")).toBeUndefined();
    });
});

describe("buildVisitTypeCssText", () => {
    it("emits a var for every registered code after setVisitTypeRegistry", () => {
        setVisitTypeRegistry([...BUILT_IN_VISIT_TYPE_CONFIGS]);
        const css = getVisitTypeCssText();
        expect(css).toContain("--vt-grad-PT11: linear-gradient(135deg, #039be5 0%, #0288d1 100%);");
        expect(css).toContain("--vt-bg-PT11: #039be5;");
    });

    it("keeps a built-in's curated gradient rather than deriving one", () => {
        const css = buildVisitTypeCssText([PT11]);
        expect(css).toContain("linear-gradient(135deg, #039be5 0%, #0288d1 100%)");
    });

    it("derives a gradient for a custom colour", () => {
        const custom: VisitTypeConfig = {
            code: "PT26",
            label: "Custom",
            bg: "#112233",
            gradient: "",
        };
        expect(buildVisitTypeCssText([custom])).toContain(
            "--vt-grad-PT26: linear-gradient(135deg, #112233 0%, #0e1c2a 100%);"
        );
    });

    it("omits any entry whose bg fails hex validation", () => {
        // A malformed custom property is invalid at computed-value time, which
        // makes CSS apply `unset` rather than the var() fallback — the chip
        // would render transparent instead of gray. So bad entries are dropped.
        const bad: VisitTypeConfig = {
            code: "PT26",
            label: "Corrupt",
            bg: "red",
            gradient: "red",
        };
        const css = buildVisitTypeCssText([bad, PT11]);
        expect(css).not.toContain("PT26");
        expect(css).toContain("--vt-bg-PT11");
    });

    it("refuses to pass an unsafe gradient string through to CSS", () => {
        const injected: VisitTypeConfig = {
            code: "PT27",
            label: "Injected",
            bg: "#112233",
            gradient: "red; } body { display: none; } :root {",
        };
        const css = buildVisitTypeCssText([injected]);
        expect(css).not.toContain("display: none");
        expect(css).toContain("--vt-grad-PT27: linear-gradient(135deg, #112233 0%, #0e1c2a 100%);");
    });
});
