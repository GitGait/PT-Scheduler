import { useState } from "react";
import { useAppointmentStore } from "../stores";
import { useScheduleStore } from "../stores";
import { db } from "../db/schema";
import type { Appointment } from "../types";
import { getHomeBase, orderByFarthestFromHome } from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";
import { beginUndoBatch, endUndoBatch, abortUndoBatch } from "../stores/undoStore";

const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";
const triggerSync = () => {
    window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
};

interface WeekActionsResult {
    weekActionInProgress: boolean;
    weekActionMessage: string | null;
    weekActionError: string | null;
    autoArrangeInProgressByDay: Record<string, boolean>;
    autoArrangeError: string | null;
    handleClearWeek: () => Promise<void>;
    handleAutoArrangeDay: (date: string) => Promise<void>;
}

export function useWeekActions(
    weekDates: string[],
    appointmentsByDay: Record<string, Appointment[]>,
    homeCoordinates: { lat: number; lng: number } | null,
    resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>,
    resetInteractionState: () => void,
): WeekActionsResult {
    const { update, delete: deleteAppointment, loadByRange } = useAppointmentStore();
    const { setSelectedDate } = useScheduleStore();

    const [weekActionInProgress, setWeekActionInProgress] = useState(false);
    const [weekActionMessage, setWeekActionMessage] = useState<string | null>(null);
    const [weekActionError, setWeekActionError] = useState<string | null>(null);
    const [autoArrangeInProgressByDay, setAutoArrangeInProgressByDay] = useState<Record<string, boolean>>({});
    const [autoArrangeError, setAutoArrangeError] = useState<string | null>(null);

    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];

    const handleAutoArrangeDay = async (date: string) => {
        const dayAppointments = (appointmentsByDay[date] ?? [])
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime));

        if (dayAppointments.length === 0) {
            return;
        }

        setAutoArrangeError(null);
        setAutoArrangeInProgressByDay((current) => ({
            ...current,
            [date]: true,
        }));

        try {
            // Personal events stay pinned — only rearrange patient appointments
            const patientAppointments = dayAppointments.filter((a) => !isPersonalEvent(a));

            if (patientAppointments.length === 0) {
                return;
            }

            // Start optimized routes at 9:00 AM
            const OPTIMIZE_START_MINUTES = 9 * 60;

            const withCoordinates: Array<{
                appointment: Appointment;
                lat: number;
                lng: number;
            }> = [];
            const withoutCoordinates: Appointment[] = [];

            for (const appointment of patientAppointments) {
                const coords = await resolvePatientCoordinatesForRouting(appointment.patientId);
                if (coords) {
                    withCoordinates.push({
                        appointment,
                        lat: coords.lat,
                        lng: coords.lng,
                    });
                } else {
                    withoutCoordinates.push(appointment);
                }
            }

            const homeBase = getHomeBase();
            const optimizedWithCoordinates = orderByFarthestFromHome(
                withCoordinates,
                homeCoordinates ?? { lat: homeBase.lat, lng: homeBase.lng }
            );

            const orderedAppointments = [
                ...optimizedWithCoordinates.map((item) => item.appointment),
                ...withoutCoordinates,
            ];

            // One undo entry for the whole day, not one per appointment. The
            // store's no-op suppression keeps an already-optimal day from
            // producing an entry at all.
            beginUndoBatch("auto-arrange", "Day auto-arranged");

            // Start at the optimized route start time
            let nextStartMinutes = OPTIMIZE_START_MINUTES;
            for (const appointment of orderedAppointments) {
                // Snap to 15-minute slots
                const snappedMinutes = Math.round(nextStartMinutes / 15) * 15;
                const hours = Math.floor(snappedMinutes / 60);
                const mins = snappedMinutes % 60;
                const nextStartTime = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

                // Always update to force the new time
                await update(appointment.id, {
                    date,
                    startTime: nextStartTime,
                });

                nextStartMinutes = snappedMinutes + appointment.duration;
            }

            endUndoBatch();

            // Reload appointments to ensure UI reflects the changes
            await loadByRange(weekStart, weekEnd);
            setSelectedDate(date);
            triggerSync();
        } catch (err) {
            abortUndoBatch();
            setAutoArrangeError(
                err instanceof Error
                    ? err.message
                    : "Failed to auto arrange appointments for this day."
            );
            setTimeout(() => setAutoArrangeError(null), 5000);
        } finally {
            setAutoArrangeInProgressByDay((current) => ({
                ...current,
                [date]: false,
            }));
        }
    };

    const handleClearWeek = async () => {
        const weekAppointments = (await db.appointments
            .where("date")
            .between(weekStart, weekEnd, true, true)
            .toArray())
            .slice()
            .sort((a, b) =>
                a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
            );

        if (weekAppointments.length === 0) {
            setWeekActionError(null);
            setWeekActionMessage("No appointments to clear for this week.");
            setTimeout(() => setWeekActionMessage(null), 5000);
            return;
        }

        const confirmed = window.confirm(
            `Clear all ${weekAppointments.length} appointment${weekAppointments.length === 1 ? "" : "s"} from ${weekStart} to ${weekEnd}?`
        );
        if (!confirmed) {
            return;
        }

        setWeekActionInProgress(true);
        setWeekActionError(null);
        setWeekActionMessage(null);
        resetInteractionState();

        try {
            // The retry loop can issue up to 2N deletes; the batch dedupes by
            // target id keeping the first snapshot, which is the original state.
            beginUndoBatch(
                "clear-week",
                `Cleared ${weekAppointments.length} appointment${weekAppointments.length === 1 ? "" : "s"}`
            );

            let remainingAppointments = weekAppointments;
            for (let attempt = 0; attempt < 2 && remainingAppointments.length > 0; attempt += 1) {
                for (const appointment of remainingAppointments) {
                    await deleteAppointment(appointment.id);
                }

                remainingAppointments = await db.appointments
                    .where("date")
                    .between(weekStart, weekEnd, true, true)
                    .toArray();
            }

            endUndoBatch();

            await loadByRange(weekStart, weekEnd);
            triggerSync();

            if (remainingAppointments.length > 0) {
                setWeekActionError(
                    `Cleared most appointments, but ${remainingAppointments.length} still remained. Press Clear Week again to remove them.`
                );
            } else {
                setWeekActionMessage(
                    `Cleared ${weekAppointments.length} appointment${weekAppointments.length === 1 ? "" : "s"} for this week.`
                );
                setTimeout(() => setWeekActionMessage(null), 5000);
            }
        } catch (err) {
            abortUndoBatch();
            setWeekActionError(
                err instanceof Error ? err.message : "Failed to clear appointments for this week."
            );
        } finally {
            setWeekActionInProgress(false);
        }
    };

    return {
        weekActionInProgress,
        weekActionMessage,
        weekActionError,
        autoArrangeInProgressByDay,
        autoArrangeError,
        handleClearWeek,
        handleAutoArrangeDay,
    };
}
