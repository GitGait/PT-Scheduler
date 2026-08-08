import { describe, it, expect } from "vitest";
import { formatPatientDisplayName } from "./patientName";

describe("formatPatientDisplayName", () => {
    it("returns the full name when there are no nicknames", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe", nicknames: [] })).toBe("Jane Doe");
    });

    it("returns the full name when nicknames is absent", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe" })).toBe("Jane Doe");
    });

    it("returns the full name when every nickname is blank", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe", nicknames: ["", "  "] })).toBe(
            "Jane Doe"
        );
    });

    it("puts the nickname first so truncation eats the last name", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe", nicknames: ["Janie"] })).toBe(
            '"Janie" Jane Doe'
        );
    });

    it("uses the first non-blank nickname and trims it", () => {
        expect(
            formatPatientDisplayName({ fullName: "Margaret Davis", nicknames: ["  ", " Maggie ", "Peggy"] })
        ).toBe('"Maggie" Margaret Davis');
    });

    it("skips a nickname that is already a word in the full name", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe", nicknames: ["Jane"] })).toBe(
            "Jane Doe"
        );
    });

    it("matches that redundant nickname case-insensitively", () => {
        expect(formatPatientDisplayName({ fullName: "Jane Doe", nicknames: ["jane"] })).toBe(
            "Jane Doe"
        );
    });

    it("keeps a nickname that is only a prefix of a name token", () => {
        expect(formatPatientDisplayName({ fullName: "Janet Doe", nicknames: ["Jan"] })).toBe(
            '"Jan" Janet Doe'
        );
    });
});
