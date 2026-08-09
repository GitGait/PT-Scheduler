import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../stores/undoApply", () => ({ applyNextUndo: vi.fn() }));

import { applyNextUndo } from "../stores/undoApply";
import { useUndoStack, UNDO_TOAST_MS, UNDO_EXHAUSTED_MS } from "./useUndoStack";
import { useUndoStore, recordUndo, __resetUndoModuleState } from "../stores/undoStore";

function pushMove(appointmentId: string, startTime = "09:00") {
    act(() => {
        recordUndo({
            kind: "update",
            reason: "move",
            appointmentId,
            before: { startTime },
            after: { startTime: "10:00" },
        });
    });
}

function pushDelete(appointmentId: string) {
    act(() => {
        recordUndo({
            kind: "delete",
            appointmentId,
            snapshot: {
                patientId: "p1",
                date: "2026-08-10",
                startTime: "09:00",
                duration: 60,
                status: "scheduled",
                syncStatus: "local",
                visitType: null,
            },
        });
    });
}

describe("useUndoStack", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders nothing on an empty stack", () => {
        const { result } = renderHook(() => useUndoStack());
        expect(result.current.mode).toBe("hidden");
    });

    it("expands with the entry label on push", () => {
        const { result } = renderHook(() => useUndoStack());
        pushMove("a");

        expect(result.current).toMatchObject({ mode: "expanded", message: "Appointment moved", canUndo: true });
    });

    it("swaps the message and resets the timer on a second push", () => {
        const { result } = renderHook(() => useUndoStack());
        pushMove("a");

        act(() => {
            vi.advanceTimersByTime(UNDO_TOAST_MS - 500);
        });
        expect(result.current.mode).toBe("expanded");

        pushDelete("b");
        expect(result.current).toMatchObject({ mode: "expanded", message: "Appointment deleted" });

        // The original deadline passes — the reset timer must keep it expanded.
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(result.current.mode).toBe("expanded");

        act(() => {
            vi.advanceTimersByTime(UNDO_TOAST_MS);
        });
        expect(result.current.mode).toBe("collapsed");
    });

    it("shows a count once more than one entry is stacked", () => {
        const { result } = renderHook(() => useUndoStack());
        pushMove("a");
        pushMove("b");
        pushMove("c");

        expect(result.current).toMatchObject({ mode: "expanded", detail: "2 more" });
    });

    it("collapses to the pill rather than hiding while depth remains", () => {
        const { result } = renderHook(() => useUndoStack());
        pushMove("a");

        act(() => {
            vi.advanceTimersByTime(UNDO_TOAST_MS);
        });

        expect(result.current).toMatchObject({ mode: "collapsed", depth: 1 });
    });

    it("applies once per click and re-expands with the next label", async () => {
        vi.mocked(applyNextUndo).mockImplementation(async () => {
            useUndoStore.getState().pop();
            return { status: "applied", label: "Appointment deleted" };
        });

        const { result } = renderHook(() => useUndoStack());
        pushMove("a");
        pushDelete("b");

        await act(async () => {
            result.current.undo();
            await Promise.resolve();
        });

        expect(applyNextUndo).toHaveBeenCalledTimes(1);
        // Now showing what the NEXT undo would revert, with a fresh window.
        expect(result.current).toMatchObject({ mode: "expanded", message: "Appointment moved" });

        act(() => {
            vi.advanceTimersByTime(UNDO_TOAST_MS - 1);
        });
        expect(result.current.mode).toBe("expanded");
    });

    it("shows a terminal message with no button when the stack runs out", async () => {
        vi.mocked(applyNextUndo).mockImplementation(async () => {
            useUndoStore.getState().pop();
            return { status: "applied", label: "Appointment moved" };
        });

        const { result } = renderHook(() => useUndoStack());
        pushMove("a");

        await act(async () => {
            result.current.undo();
            await Promise.resolve();
        });

        expect(result.current).toMatchObject({
            mode: "expanded",
            message: "Nothing left to undo",
            canUndo: false,
        });

        act(() => {
            vi.advanceTimersByTime(UNDO_EXHAUSTED_MS);
        });
        expect(result.current.mode).toBe("hidden");
    });

    it("reports empty from the applier as the terminal message", async () => {
        vi.mocked(applyNextUndo).mockResolvedValue({ status: "empty" });

        const { result } = renderHook(() => useUndoStack());
        pushMove("a");

        await act(async () => {
            result.current.undo();
            await Promise.resolve();
        });

        expect(result.current).toMatchObject({ message: "Nothing left to undo", canUndo: false });
    });

    it("invokes the applier once for a rapid double-click", async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(applyNextUndo).mockImplementation(async () => {
            await gate;
            useUndoStore.getState().pop();
            return { status: "applied", label: "Appointment moved" };
        });

        const { result } = renderHook(() => useUndoStack());
        pushMove("a");
        pushMove("b");

        await act(async () => {
            result.current.undo();
            result.current.undo();
            release?.();
            await Promise.resolve();
        });

        expect(applyNextUndo).toHaveBeenCalledTimes(1);
    });
});
