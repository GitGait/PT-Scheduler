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
    type VisitTypeConfig,
} from "./visitTypeColors";

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
