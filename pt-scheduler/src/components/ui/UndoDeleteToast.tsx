import { RotateCcw } from "lucide-react";
import { useUndoStack } from "../../hooks/useUndoStack";

const POSITION = "fixed bottom-40 sm:bottom-24 left-1/2 -translate-x-1/2 z-50";

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
