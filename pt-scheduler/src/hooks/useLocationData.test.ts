import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Appointment, Patient } from "../types";

// Mock the Distance Matrix API before importing the hook
const getDistanceMatrixMock = vi.fn();
vi.mock("../api/distance", () => ({
    getDistanceMatrix: (...args: unknown[]) => getDistanceMatrixMock(...args),
}));

// Mock geocoding so it never fires network. Each test sets specific returns
// per address via vi.mocked(geocodeAddress).mockImplementation.
vi.mock("../api/geocode", () => ({
    geocodeAddress: vi.fn(async () => ({ lat: 0, lng: 0 })),
}));

import { useLocationData } from "./useLocationData";
import { db } from "../db/schema";
import { patientDB } from "../db/operations";
import { geocodeAddress } from "../api/geocode";
import { usePatientStore } from "../stores/patientStore";

const SELECTED_DATE = "2026-04-15";

function makePatient(overrides: Partial<Patient> & { id: string }): Patient {
    return {
        fullName: `Patient ${overrides.id}`,
        nicknames: [],
        phoneNumbers: [],
        alternateContacts: [],
        address: `${overrides.id} main st`,
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
        vi.mocked(geocodeAddress).mockReset();
        await db.patients.clear();
        usePatientStore.setState({ patients: [], loading: false, error: null, searchQuery: "" });
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
            makePatient({ id: "p1", address: "p1 main st" }),
            makePatient({ id: "p2", address: "p2 main st" }),
        ];
        const appointments = [
            makeAppointment({ id: "apt1", patientId: "p1" }),
            makeAppointment({ id: "apt2", patientId: "p2", startTime: "10:00" }),
        ];

        vi.mocked(geocodeAddress).mockImplementation(async (address: string) => {
            if (address === "p1 main st") return { lat: 40.6, lng: -74.6 };
            if (address === "p2 main st") return { lat: 40.7, lng: -74.7 };
            return { lat: 0, lng: 0 };
        });

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

    it("does NOT persist geocoded patient coords to the Patient record (ToS §3.2.3(b))", async () => {
        // Seed a patient with an address but no lat/lng in the real DB.
        const patientId = await patientDB.add({
            fullName: "Non-Persist Test Patient",
            nicknames: [],
            phoneNumbers: [],
            alternateContacts: [],
            address: "456 elm st",
            status: "active",
            notes: "",
        });

        vi.mocked(geocodeAddress).mockImplementation(async () => ({ lat: 40, lng: -74 }));

        await usePatientStore.getState().loadAll();

        const patient = makePatient({ id: patientId, address: "456 elm st" });
        const appointments = [makeAppointment({ id: "apt-no-persist", patientId })];
        const inputs = buildInputs([patient], appointments);

        getDistanceMatrixMock.mockResolvedValue({ distances: [] });

        renderHook(() =>
            useLocationData(
                inputs.appointments,
                inputs.patientById,
                inputs.appointmentsByDay,
                inputs.selectedDayAppointments,
                inputs.selectedDate,
            ),
        );

        await waitFor(() => {
            expect(vi.mocked(geocodeAddress)).toHaveBeenCalledWith("456 elm st");
        }, { timeout: 2000 });

        // Give the hook's effects a chance to do anything they might try.
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Compliance assertion: the Patient record in IndexedDB must NOT have
        // been updated with lat/lng. Geocoded coordinates should live in React
        // state only for the session, and in the geocodeAddress wrapper's
        // 30-day-TTL cache — never persistently on the Patient itself.
        const saved = await patientDB.get(patientId);
        expect(saved?.lat).toBeUndefined();
        expect(saved?.lng).toBeUndefined();

        // Flush any pending distance-matrix debounce so it doesn't pollute later tests.
        await new Promise((resolve) => setTimeout(resolve, 600));
    });
});
