import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Appointment, Patient } from "../types";
import { PERSONAL_PATIENT_ID } from "../utils/personalEventColors";
import { AppointmentDetailModal } from "./AppointmentDetailModal";

// The modal looks up recurring siblings for personal events on open.
vi.mock("../db/operations", () => ({
    appointmentDB: {
        findRecurringSiblings: vi.fn().mockResolvedValue([]),
    },
}));

afterEach(cleanup);

function makePatient(overrides: Partial<Patient> = {}): Patient {
    return {
        id: "p1",
        fullName: "Smith, John",
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

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
    return {
        id: "a1",
        patientId: "p1",
        date: "2026-08-10",
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

interface Handlers {
    onSavePatient: Mock<(patientId: string, changes: Partial<Patient>) => Promise<void>>;
    onSyncToSheet: Mock<(patient: Patient) => Promise<void>>;
    onClose: Mock<() => void>;
}

function renderModal(
    { patient = makePatient(), appointment = makeAppointment() }: { patient?: Patient; appointment?: Appointment } = {}
): Handlers {
    const handlers: Handlers = {
        onSavePatient: vi.fn().mockResolvedValue(undefined),
        onSyncToSheet: vi.fn().mockResolvedValue(undefined),
        onClose: vi.fn(),
    };
    render(
        <AppointmentDetailModal
            appointment={appointment}
            patient={appointment.patientId === PERSONAL_PATIENT_ID ? undefined : patient}
            isOpen
            onClose={handlers.onClose}
            onSavePatient={handlers.onSavePatient}
            onSaveAppointment={vi.fn().mockResolvedValue(undefined)}
            onChipNote={vi.fn()}
            onPatientChipNote={vi.fn()}
            onSyncToSheet={handlers.onSyncToSheet}
        />
    );
    return handlers;
}

const patientNoteBox = () => screen.getByPlaceholderText(/gate code 4412/i);
const save = () => fireEvent.click(screen.getByText("Save Changes"));

describe("AppointmentDetailModal — patient profile note", () => {
    it("prefills the textarea from the patient record", () => {
        renderModal({ patient: makePatient({ notes: "Gate code 4412" }) });

        expect(patientNoteBox()).toHaveValue("Gate code 4412");
    });

    it("saves the edited note, trimmed, through onSavePatient", async () => {
        const { onSavePatient } = renderModal();

        fireEvent.change(patientNoteBox(), { target: { value: "  Dog in the yard  " } });
        save();

        await waitFor(() => expect(onSavePatient).toHaveBeenCalledTimes(1));
        expect(onSavePatient.mock.calls[0][0]).toBe("p1");
        expect(onSavePatient.mock.calls[0][1]).toMatchObject({ notes: "Dog in the yard" });
    });

    it("carries the new note into the immediate sheet write", async () => {
        // Regression guard: a field missing from the optimistic patient object
        // gets pushed back stale over the queued write.
        const { onSyncToSheet } = renderModal({ patient: makePatient({ notes: "Old note" }) });

        fireEvent.change(patientNoteBox(), { target: { value: "New note" } });
        save();

        await waitFor(() => expect(onSyncToSheet).toHaveBeenCalledTimes(1));
        expect(onSyncToSheet.mock.calls[0][0]).toMatchObject({ id: "p1", notes: "New note" });
    });

    it("saves an emptied note — a blank profile note is valid", async () => {
        const { onSavePatient } = renderModal({ patient: makePatient({ notes: "Gate code 4412" }) });

        fireEvent.change(patientNoteBox(), { target: { value: "" } });
        save();

        await waitFor(() => expect(onSavePatient).toHaveBeenCalledTimes(1));
        expect(onSavePatient.mock.calls[0][1]).toMatchObject({ notes: "" });
    });

    it("does not write anything when the note is left untouched", async () => {
        const { onSavePatient, onSyncToSheet, onClose } = renderModal({
            patient: makePatient({ notes: "Gate code 4412" }),
        });

        save();

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onSavePatient).not.toHaveBeenCalled();
        expect(onSyncToSheet).not.toHaveBeenCalled();
    });

    it("is hidden for personal events, which have no patient", () => {
        renderModal({
            appointment: makeAppointment({ patientId: PERSONAL_PATIENT_ID, title: "Lunch" }),
        });

        expect(screen.queryByPlaceholderText(/gate code 4412/i)).toBeNull();
    });
});

describe("AppointmentDetailModal — chip preview caption", () => {
    it("names the first line that is not import boilerplate", () => {
        renderModal({ patient: makePatient({ notes: "Email: a@b.com\nGate code 4412" }) });

        expect(screen.getByText('Chip shows: "Gate code 4412"')).toBeDefined();
    });

    it("updates live as the note is typed", () => {
        renderModal();

        fireEvent.change(patientNoteBox(), { target: { value: "Park on the street" } });

        expect(screen.getByText('Chip shows: "Park on the street"')).toBeDefined();
    });

    it("says nothing will show when the note is only boilerplate", () => {
        renderModal({ patient: makePatient({ notes: "Created from scan import" }) });

        expect(screen.getByText("Nothing from this note will show on the chip.")).toBeDefined();
    });
});
