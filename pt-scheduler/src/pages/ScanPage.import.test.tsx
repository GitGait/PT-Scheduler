import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

// Stable hoisted state objects so action identities don't churn across
// re-renders — effects here depend on store actions and would otherwise loop.
const { patientStoreState, appointmentStoreState, scheduleStoreState } = vi.hoisted(() => ({
    patientStoreState: {
        patients: [],
        loadAll: vi.fn().mockResolvedValue(undefined),
        add: vi.fn(),
        reactivate: vi.fn().mockResolvedValue(undefined),
    },
    appointmentStoreState: {
        appointments: [],
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
    },
    scheduleStoreState: {
        setSelectedDate: vi.fn(),
    },
}));

vi.mock("../stores", () => ({
    usePatientStore: () => patientStoreState,
    useAppointmentStore: Object.assign(() => appointmentStoreState, {
        getState: () => appointmentStoreState,
    }),
    useScheduleStore: Object.assign(() => scheduleStoreState, {
        getState: () => scheduleStoreState,
    }),
}));

vi.mock("../stores/undoStore", () => ({
    runWithoutUndo: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

// Three visits for the same new patient in one scanned week — the exact shape
// that used to mint three separate profiles. Hoisted so the vi.mock factory,
// which is lifted above these declarations, can reach it.
const { samePatientThreeVisits } = vi.hoisted(() => ({
    samePatientThreeVisits: {
        appointments: [
            { rawName: "Robert Vance", date: "2026-08-18", time: "09:00", duration: 60, visitType: null, notes: "" },
            { rawName: "Robert Vance", date: "2026-08-20", time: "10:00", duration: 60, visitType: null, notes: "" },
            { rawName: "Robert Vance", date: "2026-08-22", time: "11:00", duration: 60, visitType: null, notes: "" },
        ],
    },
}));

vi.mock("../api/ocr", () => ({
    processScreenshotFile: vi.fn().mockResolvedValue(samePatientThreeVisits),
}));

vi.mock("../api/geocode", () => ({
    geocodeAddress: vi.fn().mockRejectedValue(new Error("no geocoding in tests")),
}));

import { ScanPage } from "./ScanPage";

describe("ScanPage import — one profile per person", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        let createdPatients = 0;
        patientStoreState.add.mockImplementation(async () => `new-patient-${++createdPatients}`);
        let createdAppointments = 0;
        appointmentStoreState.create.mockImplementation(async () => `new-appt-${++createdAppointments}`);
    });

    it("creates one patient for a name scanned across several visits", async () => {
        render(
            <BrowserRouter>
                <ScanPage />
            </BrowserRouter>
        );

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["screenshot"], "week.png", { type: "image/png" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        // Every row is unmatched (no existing patients), so each needs the
        // explicit "Import as New Patient" confirmation.
        const newPatientButtons = await waitFor(() => {
            const buttons = screen.getAllByRole("button", { name: /Import as New Patient/i });
            expect(buttons).toHaveLength(3);
            return buttons;
        });
        newPatientButtons.forEach((button) => fireEvent.click(button));

        const importButton = await screen.findByRole("button", { name: /Import 3 Appointments/i });
        fireEvent.click(importButton);

        await waitFor(() => {
            expect(appointmentStoreState.create).toHaveBeenCalledTimes(3);
        });

        expect(patientStoreState.add).toHaveBeenCalledTimes(1);
        expect(patientStoreState.add).toHaveBeenCalledWith(
            expect.objectContaining({ fullName: "Robert Vance" })
        );

        const patientIds = appointmentStoreState.create.mock.calls.map(([appt]) => appt.patientId);
        expect(new Set(patientIds).size).toBe(1);
    });
});
