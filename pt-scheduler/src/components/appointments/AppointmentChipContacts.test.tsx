import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Patient } from "../../types";
import {
    ChipAlternateContactRows,
    ChipPhoneRows,
    chipPhoneTooltip,
    formatPhoneEntry,
} from "./AppointmentChipContacts";

afterEach(cleanup);

const TALL = 88; // enough for every phone and the alternate contacts
const MEDIUM = 60; // primary phone only
const SHORT = 40; // no contact rows at all

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

const TWO_PHONES = [
    { number: "555-111-2222", label: "Cell" },
    { number: "555-333-4444", label: "Home" },
];

function renderPhones(patient: Patient, heightPx: number) {
    return render(<ChipPhoneRows patient={patient} heightPx={heightPx} isDayView={false} />);
}

describe("ChipPhoneRows", () => {
    it("renders every phone number, in array order, on a tall chip", () => {
        const { container } = renderPhones(makePatient({ phoneNumbers: TWO_PHONES }), TALL);

        expect(container.textContent).toContain("Cell: 555-111-2222");
        expect(container.textContent).toContain("Home: 555-333-4444");
        expect(container.textContent.indexOf("Cell")).toBeLessThan(container.textContent.indexOf("Home"));
    });

    it("renders only the primary phone on a medium chip", () => {
        renderPhones(makePatient({ phoneNumbers: TWO_PHONES }), MEDIUM);

        expect(screen.getByText("Cell: 555-111-2222")).toBeDefined();
        expect(screen.queryByText("Home: 555-333-4444")).toBeNull();
    });

    it("renders nothing on a short chip", () => {
        const { container } = renderPhones(makePatient({ phoneNumbers: TWO_PHONES }), SHORT);

        expect(container.textContent).toBe("");
    });

    it("renders a bare number when the entry has no label", () => {
        renderPhones(makePatient({ phoneNumbers: [{ number: "555-111-2222" }] }), TALL);

        expect(screen.getByText("555-111-2222")).toBeDefined();
        expect(screen.queryByText(/undefined/)).toBeNull();
    });

    it("skips entries with a blank number", () => {
        const { container } = renderPhones(
            makePatient({ phoneNumbers: [{ number: "555-111-2222" }, { number: "", label: "Work" }] }),
            TALL
        );

        expect(container.textContent).toContain("555-111-2222");
        expect(container.textContent).not.toContain("Work");
    });

    it("renders exactly one row for a patient with one phone", () => {
        const { container } = renderPhones(makePatient({ phoneNumbers: [{ number: "555-111-2222" }] }), TALL);

        expect(container.querySelectorAll("span.truncate")).toHaveLength(1);
    });

    it("renders nothing when the patient has no phones", () => {
        const { container } = renderPhones(makePatient(), TALL);

        expect(container.textContent).toBe("");
    });
});

describe("ChipAlternateContactRows", () => {
    const contacts = [
        { firstName: "Mary", phone: "555-999-0000", relationship: "Daughter" },
        { firstName: "", phone: "555-888-0000" },
    ];

    it("renders one row per contact on a tall chip", () => {
        render(
            <ChipAlternateContactRows
                patient={makePatient({ alternateContacts: contacts })}
                heightPx={TALL}
                isDayView={false}
            />
        );

        expect(screen.getByText("Mary: 555-999-0000")).toBeDefined();
        expect(screen.getByText("555-888-0000")).toBeDefined();
    });

    it("renders nothing below the height gate", () => {
        const { container } = render(
            <ChipAlternateContactRows
                patient={makePatient({ alternateContacts: contacts })}
                heightPx={MEDIUM}
                isDayView={false}
            />
        );

        expect(container.textContent).toBe("");
    });
});

describe("formatPhoneEntry", () => {
    it("prefixes the label when there is one", () => {
        expect(formatPhoneEntry({ number: "555-111-2222", label: "Cell" })).toBe("Cell: 555-111-2222");
    });

    it("returns the bare number when there is no label", () => {
        expect(formatPhoneEntry({ number: "555-111-2222" })).toBe("555-111-2222");
    });
});

describe("chipPhoneTooltip", () => {
    it("joins every non-empty number", () => {
        expect(chipPhoneTooltip(makePatient({ phoneNumbers: [...TWO_PHONES, { number: "" }] }))).toBe(
            "Cell: 555-111-2222 / Home: 555-333-4444"
        );
    });

    it("is empty for a patient with no phones, and for no patient at all", () => {
        expect(chipPhoneTooltip(makePatient())).toBe("");
        expect(chipPhoneTooltip(undefined)).toBe("");
    });
});
