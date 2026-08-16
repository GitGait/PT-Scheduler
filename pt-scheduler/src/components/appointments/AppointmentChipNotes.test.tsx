import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Appointment, Patient } from "../../types";
import { AppointmentChipNotes, chipProfileNoteExtraReservePx } from "./AppointmentChipNotes";

const TALL = 94; // 30-min chip — room for 2 profile-note rows
const TALLER = 142; // 45-min chip — room for 3
const MEDIUM = 76; // between the 1-row and 2-row thresholds
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

        it("shows both lines of a two-line note on a 30-min chip", () => {
            renderNotes(makePatient({ notes: "\n  Gate code 4412  \nDog barks a lot" }));
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.getByText("Dog barks a lot")).toBeDefined();
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

        it("hides a two-line note entirely on a 15-min chip", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                makeAppointment(),
                SHORT
            );
            expect(container).toBeEmptyDOMElement();
        });

        it("shows only the first line when the chip is below the two-row threshold", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                makeAppointment(),
                MEDIUM
            );
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.queryByText("Dog barks a lot")).toBeNull();
        });

        it("shows two of three lines on a 30-min chip and all three on a 45-min chip", () => {
            const patient = makePatient({ notes: "Gate code 4412\nDog barks a lot\nUse side door" });

            renderNotes(patient, makeAppointment(), TALL);
            expect(screen.getByText("Dog barks a lot")).toBeDefined();
            expect(screen.queryByText("Use side door")).toBeNull();

            cleanup();
            renderNotes(patient, makeAppointment(), TALLER);
            expect(screen.getByText("Use side door")).toBeDefined();
        });

        it("never shows more than three lines", () => {
            renderNotes(
                makePatient({ notes: "one\ntwo\nthree\nfour" }),
                makeAppointment(),
                TALLER
            );
            expect(screen.getByText("three")).toBeDefined();
            expect(screen.queryByText("four")).toBeNull();
        });
    });

    describe("chipProfileNoteExtraReservePx", () => {
        it("reserves nothing for a single-line note", () => {
            expect(
                chipProfileNoteExtraReservePx(makeAppointment(), makePatient({ notes: "Gate code 4412" }), TALL)
            ).toBe(0);
        });

        it("reserves one row for a second visible line", () => {
            expect(
                chipProfileNoteExtraReservePx(
                    makeAppointment(),
                    makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                    TALL
                )
            ).toBe(17);
        });

        it("reserves nothing when the chip is too short to banner the note", () => {
            expect(
                chipProfileNoteExtraReservePx(
                    makeAppointment(),
                    makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                    SHORT
                )
            ).toBe(0);
        });
    });

    describe("stacking with quick notes", () => {
        it("renders quick notes first and the profile note lines last, in order", () => {
            const { container } = renderNotes(
                makePatient({
                    notes: "Gate code 4412\nDog barks a lot",
                    chipNotes: ["Call first", "Bring TheraBand"],
                })
            );
            const banners = Array.from(container.firstElementChild?.children ?? []).map(
                (el) => el.textContent
            );
            expect(banners).toEqual([
                "Call first",
                "Bring TheraBand",
                "Gate code 4412",
                "Dog barks a lot",
            ]);
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

        it("drops only the profile line that duplicates a quick note", () => {
            renderNotes(
                makePatient({
                    notes: "Gate code 4412\nDog barks a lot",
                    chipNotes: ["dog barks a lot"],
                })
            );
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.getAllByText(/dog barks a lot/i)).toHaveLength(1);
        });

        it("does not let a duplicated line burn one of the chip's rows", () => {
            renderNotes(
                makePatient({ notes: "one\ntwo\nthree", chipNotes: ["one"] }),
                makeAppointment(),
                TALL
            );
            // TALL fits 2 profile rows; "one" is already a quick note, so the
            // rows go to "two" and "three" rather than being spent on it.
            expect(screen.getByText("two")).toBeDefined();
            expect(screen.getByText("three")).toBeDefined();
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
