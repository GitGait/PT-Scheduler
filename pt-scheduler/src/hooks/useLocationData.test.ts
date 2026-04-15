import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Appointment, Patient } from "../types";

// Mock the Distance Matrix API before importing the hook
const getDistanceMatrixMock = vi.fn();
vi.mock("../api/distance", () => ({
    getDistanceMatrix: (...args: unknown[]) => getDistanceMatrixMock(...args),
}));

// Mock geocoding so it never fires in tests (patients all pre-have lat/lng)
vi.mock("../api/geocode", () => ({
    geocodeAddress: vi.fn(async () => ({ lat: 0, lng: 0 })),
}));

import { useLocationData } from "./useLocationData";
import { db } from "../db/schema";

const SELECTED_DATE = "2026-04-15";

function makePatient(overrides: Partial<Patient> & { id: string }): Patient {
    return {
        fullName: `Patient ${overrides.id}`,
        nicknames: [],
        phoneNumbers: [],
        alternateContacts: [],
        address: "123 Main St",
        status: "active",
        notes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function makeAppointment(overrides: Partial<Appointment> & { id: string; patientId: string }): Appointment {
    return {
        date: SELECTED_DATE,
        startTime: "09:00",
        duration: 45,
        status: "scheduled",
        syncStatus: "local",
        visitType: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function setHomeBase(lat: number, lng: number): void {
    window.localStorage.setItem(
        "ptScheduler.homeBase",
        JSON.stringify({ address: "Home", lat, lng }),
    );
}

describe("useLocationData", () => {
    beforeEach(async () => {
        getDistanceMatrixMock.mockReset();
        await db.distanceCache.clear();
        window.localStorage.clear();
        setHomeBase(40.5, -74.5);
    });

    function buildInputs(patients: Patient[], appointments: Appointment[]) {
        const patientById = new Map(patients.map((p) => [p.id, p]));
        const appointmentsByDay: Record<string, Appointment[]> = {
            [SELECTED_DATE]: appointments,
        };
        return {
            appointments,
            patientById,
            appointmentsByDay,
            selectedDayAppointments: appointments,
            selectedDate: SELECTED_DATE,
        };
    }

    it("fetches distances on first render for the selected day", async () => {
        const patients = [
            makePatient({ id: "p1", lat: 40.6, lng: -74.6 }),
            makePatient({ id: "p2", lat: 40.7, lng: -74.7 }),
        ];
        const appointments = [
            makeAppointment({ id: "apt1", patientId: "p1" }),
            makeAppointment({ id: "apt2", patientId: "p2", startTime: "10:00" }),
        ];

        getDistanceMatrixMock.mockResolvedValue({
            distances: [
                { originId: `home-${SELECTED_DATE}`, destinationId: "apt1", distanceMiles: 5, durationMinutes: 12 },
                { originId: "apt1", destinationId: "apt2", distanceMiles: 3, durationMinutes: 7 },
            ],
        });

        const inputs = buildInputs(patients, appointments);
        const { result } = renderHook(() =>
            useLocationData(
                inputs.appointments,
                inputs.patientById,
                inputs.appointmentsByDay,
                inputs.selectedDayAppointments,
                inputs.selectedDate,
            ),
        );

        await waitFor(() => {
            expect(getDistanceMatrixMock).toHaveBeenCalledTimes(1);
        }, { timeout: 2000 });

        await waitFor(() => {
            expect(result.current.drivingDistances.apt1).toEqual({ miles: 5, minutes: 12 });
            expect(result.current.drivingDistances.apt2).toEqual({ miles: 3, minutes: 7 });
        }, { timeout: 2000 });
    });

    it("does NOT refetch on re-render with identical inputs (cache hit)", async () => {
        const patients = [
            makePatient({ id: "p1", lat: 40.6, lng: -74.6 }),
            makePatient({ id: "p2", lat: 40.7, lng: -74.7 }),
        ];
        const appointments = [
            makeAppointment({ id: "apt1", patientId: "p1" }),
            makeAppointment({ id: "apt2", patientId: "p2", startTime: "10:00" }),
        ];

        getDistanceMatrixMock.mockResolvedValue({
            distances: [
                { originId: `home-${SELECTED_DATE}`, destinationId: "apt1", distanceMiles: 5, durationMinutes: 12 },
                { originId: "apt1", destinationId: "apt2", distanceMiles: 3, durationMinutes: 7 },
            ],
        });

        const inputs = buildInputs(patients, appointments);

        const { rerender } = renderHook(
            ({ appts, byDay, byId, selAppts, sel }) =>
                useLocationData(appts, byId, byDay, selAppts, sel),
            {
                initialProps: {
                    appts: inputs.appointments,
                    byDay: inputs.appointmentsByDay,
                    byId: inputs.patientById,
                    selAppts: inputs.selectedDayAppointments,
                    sel: SELECTED_DATE,
                },
            },
        );

        await waitFor(() => {
            expect(getDistanceMatrixMock).toHaveBeenCalledTimes(1);
        }, { timeout: 2000 });

        // Re-render with fresh-reference but identical inputs. Every reference
        // is newly allocated — Map, record, arrays — but the rounded-coord
        // signature is stable. This proves the signature memo (not reference
        // equality) is what gates the fetch effect.
        rerender({
            appts: [...appointments],
            byDay: { [SELECTED_DATE]: [...appointments] },
            byId: new Map(patients.map((p) => [p.id, p])),
            selAppts: [...appointments],
            sel: SELECTED_DATE,
        });

        // Give any pending effect a chance to fire
        await new Promise((resolve) => setTimeout(resolve, 700));

        expect(getDistanceMatrixMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT refetch on coordinate jitter below 4-decimal rounding", async () => {
        const patient1a = makePatient({ id: "p1", lat: 40.00001, lng: -74.00001 });
        const patient2 = makePatient({ id: "p2", lat: 40.7, lng: -74.7 });
        const appointments = [
            makeAppointment({ id: "apt1", patientId: "p1" }),
            makeAppointment({ id: "apt2", patientId: "p2", startTime: "10:00" }),
        ];

        getDistanceMatrixMock.mockResolvedValue({
            distances: [
                { originId: `home-${SELECTED_DATE}`, destinationId: "apt1", distanceMiles: 5, durationMinutes: 12 },
                { originId: "apt1", destinationId: "apt2", distanceMiles: 3, durationMinutes: 7 },
            ],
        });

        const { rerender } = renderHook(
            ({ appts, byDay, byId, selAppts, sel }) =>
                useLocationData(appts, byId, byDay, selAppts, sel),
            {
                initialProps: {
                    appts: appointments,
                    byDay: { [SELECTED_DATE]: appointments } as Record<string, Appointment[]>,
                    byId: new Map<string, Patient>([[patient1a.id, patient1a], [patient2.id, patient2]]),
                    selAppts: appointments,
                    sel: SELECTED_DATE,
                },
            },
        );

        await waitFor(() => {
            expect(getDistanceMatrixMock).toHaveBeenCalledTimes(1);
        }, { timeout: 2000 });

        // Jitter patient1's coordinates by less than 0.00005 (sub-rounding).
        // Rounded to 4 decimals both produce "40.0000,-74.0000", so the
        // signature is identical and no refetch should occur — even when
        // every reference passed to rerender is freshly allocated.
        const patient1b = makePatient({ id: "p1", lat: 40.00002, lng: -74.00002 });

        rerender({
            appts: [...appointments],
            byDay: { [SELECTED_DATE]: [...appointments] },
            byId: new Map<string, Patient>([[patient1b.id, patient1b], [patient2.id, patient2]]),
            selAppts: [...appointments],
            sel: SELECTED_DATE,
        });

        await new Promise((resolve) => setTimeout(resolve, 700));

        expect(getDistanceMatrixMock).toHaveBeenCalledTimes(1);
    });
});
