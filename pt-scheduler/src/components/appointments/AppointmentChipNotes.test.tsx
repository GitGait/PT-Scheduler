import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Appointment, Patient } from "../../types";
import { AppointmentChipNotes } from "./AppointmentChipNotes";

const TALL = 94; // 30-min chip
const SHORT = 46; // 15-min chip (the floor)

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
        duration: 30,
        status: "scheduled",
        syncStatus: "local",
        visitType: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function renderNotes(patient: Patient | undefined, appointment = makeAppointment(), heightPx = TALL) {
    return render(
        <AppointmentChipNotes appointment={appointment} patient={patient} heightPx={heightPx} />
    );
}

describe("AppointmentChipNotes", () => {
    // vitest runs without globals, so testing-library's auto-cleanup is not registered.
    afterEach(cleanup);

    describe("profile note", () => {
        it("shows the note when the patient has one", () => {
            renderNotes(makePatient({ notes: "Gate code 4412" }));
            expect(screen.getByText("Gate code 4412")).toBeDefined();
        });

        it("shows only the first non-blank line of a multi-line note", () => {
            renderNotes(makePatient({ notes: "\n  Gate code 4412  \nDog barks a lot" }));
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.queryByText("Dog barks a lot")).toBeNull();
        });

        it("renders nothing when the note is empty", () => {
            const { container } = renderNotes(makePatient({ notes: "   \n  " }));
            expect(container).toBeEmptyDOMElement();
        });

        it("renders nothing for a personal event with no patient", () => {
            const { container } = renderNotes(undefined);
            expect(container).toBeEmptyDOMElement();
        });
    });

    describe("boilerplate filtering", () => {
        it("ignores the scan-import stamp", () => {
            const { container } = renderNotes(makePatient({ notes: "Created from scan import" }));
            expect(container).toBeEmptyDOMElement();
        });

        it("ignores an Email: line", () => {
            const { container } = renderNotes(makePatient({ notes: "Email: a@b.com" }));
            expect(container).toBeEmptyDOMElement();
        });

        it("skips past boilerplate to the first real line", () => {
            renderNotes(makePatient({ notes: "Created from scan import\nGate code 4412\nEmail: a@b.com" }));
            expect(screen.getByText("Gate code 4412")).toBeDefined();
        });
    });

    describe("height guard", () => {
        it("hides the profile note on a 15-min chip", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Gate code 4412" }),
                makeAppointment(),
                SHORT
            );
            expect(container).toBeEmptyDOMElement();
        });

        it("shows the profile note on a 30-min chip", () => {
            renderNotes(makePatient({ notes: "Gate code 4412" }), makeAppointment(), TALL);
            expect(screen.getByText("Gate code 4412")).toBeDefined();
        });

        it("still shows quick notes on a 15-min chip", () => {
            renderNotes(
                makePatient({ chipNotes: ["Call first"] }),
                makeAppointment(),
                SHORT
            );
            expect(screen.getByText("Call first")).toBeDefined();
        });
    });

    describe("stacking with quick notes", () => {
        it("renders quick notes first and the profile note last", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Gate code 4412", chipNotes: ["Call first", "Bring TheraBand"] })
            );
            const banners = Array.from(container.firstElementChild?.children ?? []).map(
                (el) => el.textContent
            );
            expect(banners).toEqual(["Call first", "Bring TheraBand", "Gate code 4412"]);
        });

        it("keeps the profile note when appointment chip notes replace patient ones", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412", chipNotes: ["Patient level"] }),
                makeAppointment({ chipNotes: ["Appt level"] })
            );
            expect(screen.getByText("Appt level")).toBeDefined();
            expect(screen.queryByText("Patient level")).toBeNull();
            expect(screen.getByText("Gate code 4412")).toBeDefined();
        });

        it("does not duplicate a profile note that matches a quick note", () => {
            renderNotes(makePatient({ notes: "Gate code 4412", chipNotes: ["gate code 4412"] }));
            expect(screen.getAllByText(/gate code 4412/i)).toHaveLength(1);
        });

        it("puts the full profile note in the tooltip, not just the first line", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot" })
            );
            expect(container.firstElementChild?.getAttribute("title")).toBe(
                "Gate code 4412\nDog barks a lot"
            );
        });
    });

    describe("existing quick-note behavior (regression)", () => {
        it("falls back to patient chip notes when the appointment has none", () => {
            renderNotes(makePatient({ chipNotes: ["Patient level"] }));
            expect(screen.getByText("Patient level")).toBeDefined();
        });

        it("merges a legacy chipNote that is not already in chipNotes", () => {
            renderNotes(makePatient(), makeAppointment({ chipNotes: ["New"], chipNote: "Legacy" }));
            expect(screen.getByText("New")).toBeDefined();
            expect(screen.getByText("Legacy")).toBeDefined();
        });

        it("does not duplicate a legacy chipNote already present in chipNotes", () => {
            renderNotes(makePatient(), makeAppointment({ chipNotes: ["Same"], chipNote: "Same" }));
            expect(screen.getAllByText("Same")).toHaveLength(1);
        });

        it("uses the appointment color when appointment notes win", () => {
            renderNotes(
                makePatient({ chipNotes: ["Patient level"], chipNoteColor: "green" }),
                makeAppointment({ chipNotes: ["Appt level"], chipNoteColor: "red" })
            );
            expect(screen.getByText("Appt level").className).toContain("bg-red-400");
        });

        it("uses the patient color when patient notes are the fallback", () => {
            renderNotes(makePatient({ chipNotes: ["Patient level"], chipNoteColor: "blue" }));
            expect(screen.getByText("Patient level").className).toContain("bg-blue-400");
        });

        it("keeps banners non-interactive so drag and resize pass through", () => {
            const { container } = renderNotes(makePatient({ notes: "Gate code 4412" }));
            expect(container.firstElementChild?.className).toContain("pointer-events-none");
        });
    });
});
