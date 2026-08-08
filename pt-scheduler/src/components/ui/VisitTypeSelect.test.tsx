import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { VisitType } from "../../types";
import {
    BUILT_IN_VISIT_TYPE_CONFIGS,
    setVisitTypeRegistry,
    type VisitTypeConfig,
} from "../../utils/visitTypeColors";
import { VisitTypeSelect } from "./VisitTypeSelect";

type ChangeHandler = Mock<(value: VisitType) => void>;

afterEach(() => {
    cleanup();
    setVisitTypeRegistry(BUILT_IN_VISIT_TYPE_CONFIGS);
});

function renderSelect(value: VisitType, registry?: VisitTypeConfig[]): ChangeHandler {
    if (registry) setVisitTypeRegistry(registry);
    const onChange: ChangeHandler = vi.fn();
    render(<VisitTypeSelect value={value} onChange={onChange} />);
    return onChange;
}

const trigger = () => screen.getAllByRole("button")[0];
const optionLabels = () =>
    screen.getAllByRole("button").slice(1).map((b) => b.textContent?.trim() ?? "");

const CUSTOM: VisitTypeConfig = {
    code: "PT26",
    label: "Wound Care",
    bg: "#112233",
    gradient: "linear-gradient(135deg, #112233 0%, #0e1c2a 100%)",
};

describe("VisitTypeSelect", () => {
    it("renders custom types from the registry", () => {
        renderSelect(null, [...BUILT_IN_VISIT_TYPE_CONFIGS, CUSTOM]);
        fireEvent.click(trigger());
        expect(optionLabels().some((l) => l.includes("PT26 — Wound Care"))).toBe(true);
    });

    it("omits hidden types from the dropdown", () => {
        renderSelect(null, [
            ...BUILT_IN_VISIT_TYPE_CONFIGS.map((c) =>
                c.code === "PT00" ? { ...c, hidden: true } : c
            ),
        ]);
        fireEvent.click(trigger());
        expect(optionLabels().some((l) => l.includes("PT00"))).toBe(false);
        expect(optionLabels().some((l) => l.includes("PT11"))).toBe(true);
    });

    it("still shows a hidden type when it is the current value", () => {
        renderSelect("PT00", [
            ...BUILT_IN_VISIT_TYPE_CONFIGS.map((c) =>
                c.code === "PT00" ? { ...c, hidden: true } : c
            ),
        ]);
        expect(trigger().textContent).toContain("PT00");
    });

    it("always includes None regardless of registry length", () => {
        // Regression test for the removed VISIT_TYPE_CONFIGS[length - 1]
        // assumption, which located "None" positionally.
        renderSelect(null, []);
        fireEvent.click(trigger());
        expect(optionLabels()).toEqual(["None"]);
        expect(trigger().textContent).toContain("None");
    });

    it("selects the option under the keyboard cursor after arrow navigation", () => {
        const onChange = renderSelect(null, [CUSTOM]);
        fireEvent.click(trigger());
        // Opens focused on "None" (index 1, the current value). Arrow down wraps to PT26.
        fireEvent.keyDown(document, { key: "ArrowDown" });
        fireEvent.keyDown(document, { key: "Enter" });
        expect(onChange).toHaveBeenCalledWith("PT26");
    });

    it("displays an unconfigured code instead of None and never nulls it out", () => {
        // Data-loss regression: a PT26 appointment scanned before PT26 was
        // configured must round-trip untouched through the detail modal.
        const onChange = renderSelect("PT26", []);
        expect(trigger().textContent).toContain("PT26");
        expect(trigger().textContent).not.toContain("None —");
        expect(trigger().textContent).toContain("Not set up");

        fireEvent.click(trigger());
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the unconfigured code selectable at the top of the list", () => {
        const onChange = renderSelect("PT26", []);
        fireEvent.click(trigger());
        expect(optionLabels()[0]).toContain("PT26");
        fireEvent.click(screen.getAllByRole("button")[1]);
        expect(onChange).toHaveBeenCalledWith("PT26");
    });
});
