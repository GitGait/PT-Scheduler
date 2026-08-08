import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Appointment, Patient } from "../../types";
import { ChipNoteEditor } from "./ChipNoteEditor";
import { useChipNoteEditor } from "./useChipNoteEditor";

function makePatient(overrides: Partial<Patient> = {}): Patient {
    return {
        id: "p1",
        fullName: "John Smith",
        nicknames: [],
        phoneNumbers: [],
        alternateContacts: [],
        address: "",
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

interface HarnessProps {
    appointment?: Appointment;
    patient?: Patient;
    onChipNote?: (notes: string[], color?: string) => void;
    onPatientChipNote?: (notes: string[], color?: string) => void;
    seedNewNoteText?: string;
}

/** Renders the editor with a Save button so tests can drive a real save. */
function Harness({
    appointment = makeAppointment(),
    patient = makePatient(),
    onChipNote = vi.fn(),
    onPatientChipNote = vi.fn(),
    seedNewNoteText,
}: HarnessProps) {
    const editor = useChipNoteEditor(appointment, patient, {
        onChipNote,
        onPatientChipNote,
        seedNewNoteText,
    });
    return <ChipNoteEditor editor={editor} onSave={editor.save} />;
}

const applyToAllBox = () => screen.getByLabelText("Apply to all", { selector: "input" });
const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("ChipNoteEditor", () => {
    // vitest runs without globals, so auto-cleanup is not registered.
    afterEach(cleanup);

    describe("apply-to-all default (patient-copy delete bug)", () => {
        it("defaults ON when the notes came from the patient record", () => {
            render(<Harness patient={makePatient({ chipNotes: ["Call first"] })} />);
            expect((applyToAllBox() as HTMLInputElement).checked).toBe(true);
            expect(screen.getByText("Notes from patient record")).toBeDefined();
        });

        it("defaults OFF when the notes are appointment-level", () => {
            render(
                <Harness
                    appointment={makeAppointment({ chipNotes: ["Appt level"] })}
                    patient={makePatient({ chipNotes: ["Patient level"] })}
                />
            );
            expect((applyToAllBox() as HTMLInputElement).checked).toBe(false);
            expect(screen.getByText("Notes on this appointment")).toBeDefined();
        });

        it("defaults OFF when there are no notes at all", () => {
            render(<Harness />);
            expect((applyToAllBox() as HTMLInputElement).checked).toBe(false);
        });

        it("deleting the last patient-sourced note clears the PATIENT record", () => {
            const onChipNote = vi.fn();
            const onPatientChipNote = vi.fn();
            render(
                <Harness
                    patient={makePatient({ chipNotes: ["Call first"] })}
                    onChipNote={onChipNote}
                    onPatientChipNote={onPatientChipNote}
                />
            );

            fireEvent.click(screen.getByLabelText("Remove note: Call first"));
            fireEvent.click(saveButton());

            expect(onPatientChipNote).toHaveBeenCalledWith([], "yellow");
            expect(onChipNote).not.toHaveBeenCalled();
        });

        it("respects the user unchecking apply-to-all", () => {
            const onChipNote = vi.fn();
            const onPatientChipNote = vi.fn();
            render(
                <Harness
                    patient={makePatient({ chipNotes: ["Call first"] })}
                    onChipNote={onChipNote}
                    onPatientChipNote={onPatientChipNote}
                />
            );

            fireEvent.click(applyToAllBox());
            fireEvent.click(saveButton());

            expect(onChipNote).toHaveBeenCalledWith(["Call first"], "yellow");
            expect(onPatientChipNote).not.toHaveBeenCalled();
        });
    });

    describe("saving", () => {
        it("saves appointment-level notes by default", () => {
            const onChipNote = vi.fn();
            render(<Harness onChipNote={onChipNote} />);

            fireEvent.change(screen.getByPlaceholderText("e.g., Call 15 min before"), {
                target: { value: "Bring gait belt" },
            });
            fireEvent.click(saveButton());

            expect(onChipNote).toHaveBeenCalledWith(["Bring gait belt"], "yellow");
        });

        it("includes unsubmitted input text on save", () => {
            const onChipNote = vi.fn();
            render(<Harness appointment={makeAppointment({ chipNotes: ["First"] })} onChipNote={onChipNote} />);

            fireEvent.change(screen.getByPlaceholderText("e.g., Call 15 min before"), {
                target: { value: "Second" },
            });
            fireEvent.click(saveButton());

            expect(onChipNote).toHaveBeenCalledWith(["First", "Second"], "yellow");
        });

        it("round-trips a chosen color", () => {
            const onChipNote = vi.fn();
            render(<Harness appointment={makeAppointment({ chipNotes: ["Note"] })} onChipNote={onChipNote} />);

            fireEvent.click(screen.getByLabelText("red note color"));
            fireEvent.click(saveButton());

            expect(onChipNote).toHaveBeenCalledWith(["Note"], "red");
        });

        it("caps the list at 4 notes", () => {
            render(
                <Harness appointment={makeAppointment({ chipNotes: ["a", "b", "c", "d"] })} />
            );
            expect(screen.queryByPlaceholderText("e.g., Call 15 min before")).toBeNull();
            expect(screen.getByText("Max 4 notes reached")).toBeDefined();
        });
    });

    describe("seeding from legacy appointment notes", () => {
        it("prefills the input when there are no chip notes", () => {
            render(<Harness seedNewNoteText="Old calendar text" />);
            expect(
                (screen.getByPlaceholderText("e.g., Call 15 min before") as HTMLInputElement).value
            ).toBe("Old calendar text");
        });

        it("does not prefill when chip notes already exist", () => {
            render(
                <Harness
                    appointment={makeAppointment({ chipNotes: ["Existing"] })}
                    seedNewNoteText="Old calendar text"
                />
            );
            expect(
                (screen.getByPlaceholderText("e.g., Call 15 min before") as HTMLInputElement).value
            ).toBe("");
        });
    });

    describe("personal events", () => {
        const personal = makeAppointment({ patientId: "__personal__", personalCategory: "other" });

        it("hides apply-to-all and remove-from-all", () => {
            render(<Harness appointment={personal} patient={undefined} />);
            expect(screen.queryByText("Apply to all")).toBeNull();
            expect(screen.queryByText("Remove from all")).toBeNull();
        });

        it("saves to the appointment even with a patient carrying notes", () => {
            const onChipNote = vi.fn();
            const onPatientChipNote = vi.fn();
            render(
                <Harness
                    appointment={personal}
                    patient={makePatient({ chipNotes: ["Patient level"] })}
                    onChipNote={onChipNote}
                    onPatientChipNote={onPatientChipNote}
                />
            );

            fireEvent.click(saveButton());

            expect(onChipNote).toHaveBeenCalled();
            expect(onPatientChipNote).not.toHaveBeenCalled();
        });
    });

    describe("remove from all", () => {
        it("requires a confirm tap before firing", () => {
            const onPatientChipNote = vi.fn();
            render(
                <Harness
                    patient={makePatient({ chipNotes: ["Call first"] })}
                    onPatientChipNote={onPatientChipNote}
                />
            );

            fireEvent.click(screen.getByText("Remove from all"));
            expect(onPatientChipNote).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText("Confirm?"));
            expect(onPatientChipNote).toHaveBeenCalledWith([], undefined);
        });

        it("is hidden when the patient has no notes", () => {
            render(<Harness appointment={makeAppointment({ chipNotes: ["Appt only"] })} />);
            expect(screen.queryByText("Remove from all")).toBeNull();
        });
    });
});
