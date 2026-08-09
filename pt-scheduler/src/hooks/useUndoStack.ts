import { useCallback, useEffect, useRef, useState } from "react";
import { useUndoStore } from "../stores/undoStore";
import { applyNextUndo } from "../stores/undoApply";

/** How long the expanded toast stays up before collapsing to the pill. */
export const UNDO_TOAST_MS = 6000;
/** How long the terminal "nothing left" message stays up before unmounting. */
export const UNDO_EXHAUSTED_MS = 3000;

export type UndoSurfaceState =
    | { mode: "hidden" }
    | { mode: "expanded"; message: string; detail: string | null; canUndo: boolean }
    | { mode: "collapsed"; depth: number };

/**
 * Toast/pill state machine for the undo surface.
 *
 * Called ONLY by UndoSurface. SchedulePage subscribes to stores without a
 * selector, so calling this there would re-render the whole page on every push
 * and every timer tick. Keeping the subscription in the leaf confines those
 * re-renders to the toast's own JSX.
 */
export function useUndoStack(): UndoSurfaceState & { undo: () => void } {
    const depth = useUndoStore((s) => s.entries.length);
    const topLabel = useUndoStore((s) => (s.entries.length > 0 ? s.entries[s.entries.length - 1].label : null));

    const [expanded, setExpanded] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [exhausted, setExhausted] = useState(false);
    const timerRef = useRef<number | null>(null);
    const applyingRef = useRef(false);
    const lastEntryIdRef = useRef<string | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startTimer = useCallback(
        (ms: number, onDone: () => void) => {
            clearTimer();
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                onDone();
            }, ms);
        },
        [clearTimer]
    );

    // A new entry (re)opens the toast and resets the window, so rapid gestures
    // swap the message rather than stacking surfaces.
    //
    // Driven by a store subscription rather than an effect that reacts to
    // rendered state: the push is an external event, and setState belongs in
    // the subscription callback, not synchronously in an effect body.
    //
    // Entries already on the stack at mount deliberately do NOT pop a toast —
    // a remount shows the collapsed pill instead of replaying old history.
    useEffect(() => {
        return useUndoStore.subscribe((state) => {
            const newest = state.entries[state.entries.length - 1];
            if (!newest || newest.entryId === lastEntryIdRef.current) return;
            lastEntryIdRef.current = newest.entryId;

            setExhausted(false);
            setMessage(newest.label);
            setExpanded(true);
            startTimer(UNDO_TOAST_MS, () => setExpanded(false));
        });
    }, [startTimer]);

    useEffect(() => clearTimer, [clearTimer]);

    const undo = useCallback(() => {
        if (applyingRef.current) return;
        applyingRef.current = true;

        void applyNextUndo()
            .then((result) => {
                if (result.status === "empty") {
                    setExhausted(true);
                    setMessage(null);
                    setExpanded(true);
                    startTimer(UNDO_EXHAUSTED_MS, () => {
                        setExpanded(false);
                        setExhausted(false);
                    });
                    return;
                }

                // Stay expanded showing what the NEXT undo would revert.
                const remaining = useUndoStore.getState().entries;
                lastEntryIdRef.current = remaining.length > 0 ? remaining[remaining.length - 1].entryId : null;

                if (remaining.length === 0) {
                    setExhausted(true);
                    setMessage(null);
                    setExpanded(true);
                    startTimer(UNDO_EXHAUSTED_MS, () => {
                        setExpanded(false);
                        setExhausted(false);
                    });
                    return;
                }

                setMessage(remaining[remaining.length - 1].label);
                setExpanded(true);
                startTimer(UNDO_TOAST_MS, () => setExpanded(false));
            })
            .finally(() => {
                applyingRef.current = false;
            });
    }, [startTimer]);

    if (exhausted) {
        return { mode: "expanded", message: "Nothing left to undo", detail: null, canUndo: false, undo };
    }
    if (depth === 0) {
        return { mode: "hidden", undo };
    }
    if (expanded) {
        return {
            mode: "expanded",
            message: message ?? topLabel ?? "",
            detail: depth > 1 ? `${depth - 1} more` : null,
            canUndo: true,
            undo,
        };
    }
    return { mode: "collapsed", depth, undo };
}
