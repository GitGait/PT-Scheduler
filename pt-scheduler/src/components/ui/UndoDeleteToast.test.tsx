import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../hooks/useUndoStack", () => ({ useUndoStack: vi.fn() }));

import { useUndoStack } from "../../hooks/useUndoStack";
import { UndoSurface } from "./UndoDeleteToast";

const undo = vi.fn();

function mockState(state: Partial<ReturnType<typeof useUndoStack>>) {
    vi.mocked(useUndoStack).mockReturnValue({ undo, ...state } as ReturnType<typeof useUndoStack>);
}

describe("UndoSurface", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // vitest runs without `globals: true`, so testing-library's auto-cleanup
    // is never registered — unmount explicitly or renders pile up in the DOM.
    afterEach(cleanup);

    it("renders nothing when hidden", () => {
        mockState({ mode: "hidden" });
        const { container } = render(<UndoSurface />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the message and detail when expanded", () => {
        mockState({ mode: "expanded", message: "Appointment moved", detail: "2 more", canUndo: true });
        render(<UndoSurface />);

        expect(screen.getByText("Appointment moved")).toBeInTheDocument();
        expect(screen.getByText("2 more")).toBeInTheDocument();
    });

    it("fires undo when the button is clicked", () => {
        mockState({ mode: "expanded", message: "Appointment deleted", detail: null, canUndo: true });
        render(<UndoSurface />);

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it("omits the button when there is nothing left to undo", () => {
        mockState({ mode: "expanded", message: "Nothing left to undo", detail: null, canUndo: false });
        render(<UndoSurface />);

        expect(screen.getByText("Nothing left to undo")).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("announces politely as one atomic line", () => {
        mockState({ mode: "expanded", message: "Appointment moved", detail: null, canUndo: true });
        render(<UndoSurface />);

        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-live", "polite");
        expect(status).toHaveAttribute("aria-atomic", "true");
    });

    it("renders the collapsed pill with a labelled count", () => {
        mockState({ mode: "collapsed", depth: 3 });
        render(<UndoSurface />);

        const pill = screen.getByRole("button", { name: "Undo (3 available)" });
        expect(pill).toBeInTheDocument();
        expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("undoes from the collapsed pill", () => {
        mockState({ mode: "collapsed", depth: 2 });
        render(<UndoSurface />);

        fireEvent.click(screen.getByRole("button", { name: "Undo (2 available)" }));
        expect(undo).toHaveBeenCalledTimes(1);
    });
});
