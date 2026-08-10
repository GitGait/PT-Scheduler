import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../hooks/useUndoStack", () => ({ useUndoStack: vi.fn() }));
vi.mock("../../stores/undoApply", () => ({ applyNextUndo: vi.fn() }));

import { useUndoStack } from "../../hooks/useUndoStack";
import { applyNextUndo } from "../../stores/undoApply";
import { useUndoStore, recordUndo, __resetUndoModuleState } from "../../stores/undoStore";
import { UndoSurface, UndoPill } from "./UndoDeleteToast";

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

describe("UndoPill (mobile header control)", () => {
    function push(appointmentId: string) {
        recordUndo({
            kind: "update",
            reason: "move",
            appointmentId,
            before: { startTime: "09:00" },
            after: { startTime: "10:00" },
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
        vi.mocked(applyNextUndo).mockResolvedValue({ status: "empty" });
    });

    afterEach(cleanup);

    it("renders nothing when there is no history", () => {
        const { container } = render(<UndoPill />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows the undo count with a labelled button", () => {
        push("a");
        push("b");
        push("c");
        render(<UndoPill />);

        expect(screen.getByRole("button", { name: "Undo (3 available)" })).toBeInTheDocument();
        expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("applies an undo when tapped", () => {
        push("a");
        render(<UndoPill />);

        fireEvent.click(screen.getByRole("button", { name: "Undo (1 available)" }));
        expect(applyNextUndo).toHaveBeenCalledTimes(1);
    });

    it("applies once for a rapid double-tap", async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(applyNextUndo).mockImplementation(async () => {
            await gate;
            return { status: "empty" };
        });

        push("a");
        push("b");
        render(<UndoPill />);

        const button = screen.getByRole("button", { name: "Undo (2 available)" });
        fireEvent.click(button);
        fireEvent.click(button);
        release?.();

        expect(applyNextUndo).toHaveBeenCalledTimes(1);
    });

    it("announces the newest label in a visually hidden live region", () => {
        push("a");
        render(<UndoPill />);

        // The mobile pill shows no text, so this is the only announcement path.
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("Appointment moved");
        expect(status).toHaveClass("sr-only");
        expect(status).toHaveAttribute("aria-live", "polite");
    });
});
