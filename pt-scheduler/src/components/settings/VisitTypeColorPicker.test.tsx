import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { VISIT_TYPE_HUES } from "../../utils/visitTypeColors";
import { VisitTypeColorPicker } from "./VisitTypeColorPicker";

type ChangeHandler = Mock<(bg: string) => void>;

const RED = VISIT_TYPE_HUES.find((h) => h.name === "Red")!;
const LIGHT_BLUE = VISIT_TYPE_HUES.find((h) => h.name === "Light Blue")!;

afterEach(cleanup);

function renderPicker(value: string): ChangeHandler {
    const onChange: ChangeHandler = vi.fn();
    render(<VisitTypeColorPicker value={value} onChange={onChange} subject="PT11" />);
    return onChange;
}

const shadeButtons = (hueName: string) =>
    screen.queryAllByRole("button", { name: new RegExp(`^${hueName} shade \\d for PT11$`) });

describe("VisitTypeColorPicker", () => {
    it("offers one swatch per hue family", () => {
        renderPicker(LIGHT_BLUE.shades[1]);
        for (const hue of VISIT_TYPE_HUES) {
            expect(screen.getByRole("button", { name: `${hue.name} for PT11` })).toBeTruthy();
        }
    });

    it("applies the family's representative shade on the first tap", () => {
        const onChange = renderPicker(LIGHT_BLUE.shades[1]);
        fireEvent.click(screen.getByRole("button", { name: "Red for PT11" }));

        expect(onChange).toHaveBeenCalledWith(RED.shades[1]);
        expect(shadeButtons("Red")).toHaveLength(4);
    });

    it("applies the exact hex when a shade is tapped", () => {
        const onChange = renderPicker(RED.shades[1]);
        fireEvent.click(screen.getByRole("button", { name: "Red shade 4 for PT11" }));

        expect(onChange).toHaveBeenCalledWith(RED.shades[3]);
    });

    it("opens the family of the current colour, so refining is one tap", () => {
        // Mounted on a mid-family shade, not the representative one.
        renderPicker(LIGHT_BLUE.shades[3]);

        expect(shadeButtons("Light Blue")).toHaveLength(4);
        expect(shadeButtons("Red")).toHaveLength(0);
    });

    it("keeps the custom input reachable for a colour outside the palette", () => {
        renderPicker("#123456");

        expect(VISIT_TYPE_HUES.every((hue) => shadeButtons(hue.name).length === 0)).toBe(true);
        expect(screen.getByLabelText("Custom color for PT11")).toBeTruthy();
    });
});
