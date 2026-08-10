import { useCallback, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { useUndoStack } from "../../hooks/useUndoStack";
import { useUndoStore } from "../../stores/undoStore";
import { applyNextUndo } from "../../stores/undoApply";

// Desktop only. On mobile the bottom-center toast covered a wide strip of the
// calendar grid above the BottomNav, so UndoPill takes over below `sm`.
const POSITION = "hidden sm:flex fixed bottom-24 left-1/2 -translate-x-1/2 z-50";

/**
 * The mobile undo control: a compact icon+count pill that lives in the header
 * beside the sync button, so it blocks none of the schedule.
 *
 * Its own component rather than inline hooks in TopNav — the store subscription
 * stays confined here instead of re-rendering the whole header on every push.
 * It deliberately skips `useUndoStack`: there is no toast to time out, just a
 * depth to show and an action to run.
 */
export function UndoPill() {
    const depth = useUndoStore((s) => s.entries.length);
    const topLabel = useUndoStore((s) => (s.entries.length > 0 ? s.entries[s.entries.length - 1].label : ""));
    const applyingRef = useRef(false);

    const undo = useCallback(() => {
        if (applyingRef.current) return;
        applyingRef.current = true;
        void applyNextUndo().finally(() => {
            applyingRef.current = false;
        });
    }, []);

    if (depth === 0) return null;

    return (
        <>
            {/* The mobile pill shows no message text, so this carries the
                announcement that the hidden desktop toast would have made. */}
            <span className="sr-only" role="status" aria-live="polite">
                {topLabel}
            </span>
            <button
                type="button"
                onClick={undo}
                aria-label={`Undo (${depth} available)`}
                className="sm:hidden flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-medium border shadow-sm transition-all bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{depth}</span>
            </button>
        </>
    );
}

/**
 * The single undo surface: an expanded toast that collapses to a compact pill
 * once its window lapses, so deep history stays reachable on touch.
 *
 * Takes no props and subscribes to the undo store itself. This is load-bearing,
 * not stylistic — SchedulePage subscribes without a selector, so a props-driven
 * version would re-render the entire page on every push and every timer tick.
 */
export function UndoSurface() {
    const state = useUndoStack();

    if (state.mode === "hidden") return null;

    if (state.mode === "collapsed") {
        return (
            <button
                type="button"
                onClick={state.undo}
                aria-label={`Undo (${state.depth} available)`}
                className={`${POSITION} flex items-center gap-1.5 bg-gray-800 dark:bg-gray-700 text-white pl-3 pr-3.5 py-2 rounded-full shadow-lg text-sm`}
            >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{state.depth}</span>
            </button>
        );
    }

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`${POSITION} flex items-center gap-4 bg-gray-800 dark:bg-gray-700 text-white pl-4 pr-2 py-2 rounded shadow-lg text-sm`}
        >
            <span className="flex items-baseline gap-2">
                <span>{state.message}</span>
                {state.detail && <span className="text-xs text-gray-400">{state.detail}</span>}
            </span>
            {state.canUndo && (
                <button
                    type="button"
                    onClick={state.undo}
                    className="font-semibold uppercase text-xs tracking-wide text-[var(--color-primary)] hover:text-white px-2 py-1 rounded"
                >
                    Undo
                </button>
            )}
        </div>
    );
}
