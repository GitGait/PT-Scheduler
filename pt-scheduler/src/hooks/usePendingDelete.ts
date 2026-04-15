import { useCallback, useEffect, useRef, useState } from "react";
import { useAppointmentStore } from "../stores";
import type { Appointment } from "../types";

const UNDO_WINDOW_MS = 5000;
const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";

type PendingDelete = {
    id: string;
    appointment: Appointment;
};

export function usePendingDelete() {
    const deleteAppointment = useAppointmentStore((state) => state.delete);
    const [pending, setPending] = useState<PendingDelete | null>(null);
    const pendingRef = useRef<PendingDelete | null>(null);
    const timerRef = useRef<number | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const commit = useCallback(
        (target: PendingDelete) => {
            // Skip if the appointment has already been removed by another path
            // (e.g. Clear Week, sync pull) — avoid a redundant delete that would
            // surface as a noisy store error.
            const stillExists = useAppointmentStore
                .getState()
                .appointments.some((a) => a.id === target.id);
            if (!stillExists) return;
            void deleteAppointment(target.id).then(() => {
                window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
            });
        },
        [deleteAppointment]
    );

    const commitNow = useCallback(() => {
        clearTimer();
        const current = pendingRef.current;
        if (!current) return;
        pendingRef.current = null;
        setPending(null);
        commit(current);
    }, [clearTimer, commit]);

    const queueDelete = useCallback(
        (appointment: Appointment) => {
            // If a delete is already pending, commit it immediately before
            // starting a new undo window for the next one.
            const existing = pendingRef.current;
            if (existing) {
                clearTimer();
                pendingRef.current = null;
                commit(existing);
            }

            const next: PendingDelete = { id: appointment.id, appointment };
            pendingRef.current = next;
            setPending(next);

            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                const current = pendingRef.current;
                if (!current || current.id !== next.id) return;
                pendingRef.current = null;
                setPending(null);
                commit(current);
            }, UNDO_WINDOW_MS);
        },
        [clearTimer, commit]
    );

    const undo = useCallback(() => {
        clearTimer();
        if (!pendingRef.current) return;
        pendingRef.current = null;
        setPending(null);
    }, [clearTimer]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            const current = pendingRef.current;
            if (!current) return;
            clearTimer();
            pendingRef.current = null;
            commit(current);
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            const current = pendingRef.current;
            if (current) {
                clearTimer();
                pendingRef.current = null;
                commit(current);
            }
        };
    }, [clearTimer, commit]);

    return {
        pendingId: pending?.id ?? null,
        queueDelete,
        undo,
        commitNow,
    };
}
