import { useEffect } from "react";
import { appointmentDB, patientDB } from "../db/operations";
import { usePatientStore } from "../stores/patientStore";
import { toLocalIsoDate } from "../utils/scheduling";
import type { Appointment } from "../types";

const COOLDOWN_KEY = "ptScheduler.lastAutoDischargeCheck";
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Given an appointment date string (YYYY-MM-DD), return the Saturday of that week.
 * Week runs Mon–Sat, so Saturday is day 6 (getDay() === 6).
 */
export function getSaturdayOfWeek(dateStr: string): Date {
  const date = new Date(`${dateStr}T12:00:00`);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // If Sunday (0), Saturday was yesterday (-1 day)
  // If Monday (1), Saturday is +5 days
  // If Saturday (6), it's already Saturday (+0)
  const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
  const saturday = new Date(date);
  saturday.setDate(saturday.getDate() + daysUntilSaturday);
  return saturday;
}

/**
 * Find PT18/PT19 appointments from the last 28 days and discharge patients
 * whose discharge visit week's Saturday has passed.
 */
export async function processAutoDischarges(): Promise<number> {
  const today = new Date();
  const todayStr = toLocalIsoDate(today);

  // Look back 28 days for PT18/PT19 appointments
  const lookbackDate = new Date(today);
  lookbackDate.setDate(lookbackDate.getDate() - 28);
  const lookbackStr = toLocalIsoDate(lookbackDate);

  const appointments = await appointmentDB.byRange(lookbackStr, todayStr);

  // Filter to PT18/PT19 appointments that are scheduled or completed (not cancelled/no-show)
  const dischargeAppointments = appointments.filter(
    (appt: Appointment) =>
      (appt.visitType === "PT18" || appt.visitType === "PT19") &&
      (appt.status === "scheduled" || appt.status === "completed")
  );

  let dischargedCount = 0;

  for (const appt of dischargeAppointments) {
    const saturday = getSaturdayOfWeek(appt.date);
    const saturdayStr = toLocalIsoDate(saturday);

    // Only discharge if today >= Saturday of that appointment's week
    if (todayStr >= saturdayStr) {
      const patient = await patientDB.get(appt.patientId);
      if (patient && patient.status !== "discharged" && patient.status !== "for-other-pt") {
        await usePatientStore.getState().discharge(appt.patientId);
        dischargedCount++;
      }
    }
  }

  return dischargedCount;
}

/**
 * Hook that runs auto-discharge on mount with a 6-hour cooldown.
 */
export function useAutoDischarge(): void {
  useEffect(() => {
    const lastCheck = localStorage.getItem(COOLDOWN_KEY);
    if (lastCheck) {
      const elapsed = Date.now() - Number(lastCheck);
      if (elapsed < COOLDOWN_MS) return;
    }

    localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    processAutoDischarges().catch((err) => {
      console.error("[AutoDischarge] Failed:", err);
    });
  }, []);
}
