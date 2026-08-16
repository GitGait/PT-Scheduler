import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Appointment, Patient } from "../../types";
import { AppointmentChipNotes, chipNoteStackReservePx } from "./AppointmentChipNotes";

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

    describe("chipNoteStackReservePx", () => {
        it("reserves nothing for a single-line note", () => {
            expect(
                chipNoteStackReservePx(makeAppointment(), makePatient({ notes: "Gate code 4412" }), TALL)
            ).toBe(0);
        });

        it("reserves one row for a second visible line", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment(),
                    makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                    TALL
                )
            ).toBe(18);
        });

        it("reserves nothing when the chip is too short to banner the note", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment(),
                    makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                    SHORT
                )
            ).toBe(0);
        });

        it("counts quick notes in the reserve", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment({ chipNotes: ["a"] }),
                    makePatient({ notes: "Gate code 4412" }),
                    TALL
                )
            ).toBe(18);
        });

        it("counts the whole stack", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment({ chipNotes: ["a"] }),
                    makePatient({ notes: "Gate code 4412\nDog barks a lot" }),
                    TALL
                )
            ).toBe(36);
        });

        it("caps at what the chip can carry", () => {
            const result = chipNoteStackReservePx(
                makeAppointment({ chipNotes: ["a", "b", "c", "d"] }),
                makePatient({ notes: "" }),
                TALL
            );
            expect(result).toBe(36);
            expect(12 + result).toBeLessThanOrEqual(TALL - 20);
        });

        it("reserves nothing when only one banner fits", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment({ chipNotes: ["a", "b", "c", "d"] }),
                    makePatient({ notes: "" }),
                    SHORT
                )
            ).toBe(0);
        });

        it("six-row stack on a 60-min chip", () => {
            expect(
                chipNoteStackReservePx(
                    makeAppointment({ chipNotes: ["a", "b", "c"] }),
                    makePatient({ notes: "one\ntwo\nthree" }),
                    190
                )
            ).toBe(90);
        });
    });

    describe("banner row budget", () => {
        it("drops a profile line when quick notes take the chip's rows", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot", chipNotes: ["a", "b"] }),
                makeAppointment({ chipNotes: ["a", "b"] }),
                TALL
            );
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.queryByText("Dog barks a lot")).toBeNull();
        });

        it("keeps a 30-min chip's second profile line with only one quick note", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot", chipNotes: ["a"] }),
                makeAppointment({ chipNotes: ["a"] }),
                TALL
            );
            expect(screen.getByText("Gate code 4412")).toBeDefined();
            expect(screen.getByText("Dog barks a lot")).toBeDefined();
        });

        it("no profile lines when quick notes fill the budget", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412\nDog barks a lot", chipNotes: ["a", "b", "c"] }),
                makeAppointment({ chipNotes: ["a", "b", "c"] }),
                TALL
            );
            expect(screen.queryByText("Gate code 4412")).toBeNull();
            expect(screen.queryByText("Dog barks a lot")).toBeNull();
            expect(screen.getByText("a")).toBeDefined();
            expect(screen.getByText("b")).toBeDefined();
            expect(screen.getByText("c")).toBeDefined();
        });

        it("still shows the profile line on a 76px chip with one quick note", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412", chipNotes: ["a"] }),
                makeAppointment({ chipNotes: ["a"] }),
                MEDIUM
            );
            expect(screen.getByText("Gate code 4412")).toBeDefined();
        });

        it("never renders more rows than the chip can hold", () => {
            const { container } = renderNotes(
                makePatient({ chipNotes: ["a", "b", "c", "d", "e", "f"] }),
                makeAppointment({ chipNotes: ["a", "b", "c", "d", "e", "f"] }),
                TALL
            );
            expect(container.firstElementChild?.children.length).toBe(3);
        });

        it("always shows one quick note on a 15-min chip, even with four", () => {
            const { container } = renderNotes(
                makePatient({ chipNotes: ["a", "b", "c", "d"] }),
                makeAppointment({ chipNotes: ["a", "b", "c", "d"] }),
                SHORT
            );
            expect(container.firstElementChild?.children.length).toBe(1);
            expect(screen.getByText("a")).toBeDefined();
        });

        it("drops profile lines before quick notes", () => {
            renderNotes(
                makePatient({ notes: "Gate code 4412", chipNotes: ["a", "b"] }),
                makeAppointment({ chipNotes: ["a", "b"] }),
                SHORT
            );
            expect(screen.getByText("a")).toBeDefined();
            expect(screen.queryByText("b")).toBeNull();
            expect(screen.queryByText("Gate code 4412")).toBeNull();
        });

        it("property: the banner stack never overflows the chip (or floors at one row)", () => {
            const heights = [SHORT, MEDIUM, TALL, TALLER, 190];
            const counts = [0, 1, 2, 3, 4, 6];
            for (const h of heights) {
                for (const n of counts) {
                    const chipNotes = Array.from({ length: n }, (_, i) => `note${i}`);
                    const { container } = renderNotes(
                        makePatient({ chipNotes }),
                        makeAppointment({ chipNotes }),
                        h
                    );
                    const rows = container.firstElementChild?.children.length ?? 0;
                    expect(rows * 18 <= h || rows === 1).toBe(true);
                    cleanup();
                }
            }
        });
    });

    describe("overflow counter", () => {
        it("shows +3 on the only banner of a 15-min chip with 4 quick notes", () => {
            renderNotes(
                makePatient({ chipNotes: ["a", "b", "c", "d"] }),
                makeAppointment({ chipNotes: ["a", "b", "c", "d"] }),
                SHORT
            );
            expect(screen.getByText("+3")).toBeDefined();
        });

        it("no counter when every quick note fits", () => {
            renderNotes(
                makePatient({ chipNotes: ["a"] }),
                makeAppointment({ chipNotes: ["a"] }),
                TALL
            );
            expect(screen.queryByText(/^\+\d+$/)).toBeNull();
        });

        it("the counter sits on the last visible quick note, not the profile lines", () => {
            const { container } = renderNotes(
                makePatient({ chipNotes: ["a", "b", "c", "d"] }),
                makeAppointment({ chipNotes: ["a", "b", "c", "d"] }),
                SHORT
            );
            const lastBanner = container.firstElementChild?.children[
                (container.firstElementChild?.children.length ?? 1) - 1
            ];
            expect(lastBanner?.textContent).toContain("a");
            expect(lastBanner?.textContent).toContain("+3");
        });
    });

    describe("tooltip", () => {
        it("keeps the profile note in the tooltip when no profile line fits", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Gate code 4412", chipNotes: ["a", "b", "c"] }),
                makeAppointment({ chipNotes: ["a", "b", "c"] }),
                TALL
            );
            expect(container.firstElementChild?.getAttribute("title")).toContain("Gate code 4412");
        });

        it("lists quick notes the chip had no room to render", () => {
            const { container } = renderNotes(
                makePatient({ chipNotes: ["a", "b", "c"] }),
                makeAppointment({ chipNotes: ["a", "b", "c"] }),
                SHORT
            );
            expect(container.firstElementChild?.getAttribute("title")).toBe("a\nb\nc");
        });

        it("keeps boilerplate out of the tooltip", () => {
            const { container } = renderNotes(
                makePatient({ notes: "Created from scan import\nGate code 4412\nEmail: a@b.com" })
            );
            expect(container.firstElementChild?.getAttribute("title")).toBe("Gate code 4412");
        });
    });

    describe("stacking with quick notes", () => {
        it("renders quick notes first and the profile note lines last, in order", () => {
            const { container } = renderNotes(
                makePatient({
                    notes: "Gate code 4412\nDog barks a lot",
                    chipNotes: ["Call first", "Bring TheraBand"],
                }),
                makeAppointment(),
                TALLER
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
            // The note text lives in a truncating span; the color is on the banner row.
            expect(screen.getByText("Appt level").closest("div")?.className).toContain("bg-red-400");
        });

        it("uses the patient color when patient notes are the fallback", () => {
            renderNotes(makePatient({ chipNotes: ["Patient level"], chipNoteColor: "blue" }));
            expect(screen.getByText("Patient level").closest("div")?.className).toContain(
                "bg-blue-400"
            );
        });

        it("keeps banners non-interactive so drag and resize pass through", () => {
            const { container } = renderNotes(makePatient({ notes: "Gate code 4412" }));
            expect(container.firstElementChild?.className).toContain("pointer-events-none");
        });
    });
});
