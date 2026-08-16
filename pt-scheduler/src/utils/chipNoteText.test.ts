import { describe, it, expect } from "vitest";
import { firstMeaningfulNoteLine, meaningfulNoteLines } from "./chipNoteText";

describe("firstMeaningfulNoteLine", () => {
    it("returns the only line", () => {
        expect(firstMeaningfulNoteLine("Gate code 4412")).toBe("Gate code 4412");
    });

    it("returns the first non-blank line and trims it", () => {
        expect(firstMeaningfulNoteLine("\n  Gate code 4412  \nDog barks")).toBe("Gate code 4412");
    });

    it("returns empty string for undefined or blank input", () => {
        expect(firstMeaningfulNoteLine(undefined)).toBe("");
        expect(firstMeaningfulNoteLine("   \n  ")).toBe("");
    });

    describe("boilerplate", () => {
        it.each([
            ["Created from scan import"],
            ["Imported from Google Calendar event abc123"],
            ["Email: a@b.com"],
            ["Visit Type: PT11"],
            ["-::-::- Do not edit this section"],
            ["Join with Google Meet"],
            ["Join Zoom Meeting"],
            ["This event has a video call"],
            ["https://meet.google.com/abc-defg-hij"],
        ])("filters %j", (line) => {
            expect(firstMeaningfulNoteLine(line)).toBe("");
        });

        it("skips past boilerplate to the first real line", () => {
            expect(firstMeaningfulNoteLine("Visit Type: PT11\nGate code 4412\nEmail: a@b.com"))
                .toBe("Gate code 4412");
        });

        it("keeps a line that merely mentions a filtered word", () => {
            expect(firstMeaningfulNoteLine("Ask about the email address")).toBe(
                "Ask about the email address"
            );
        });
    });

    describe("html from calendar descriptions", () => {
        it("splits on <br> tags", () => {
            expect(firstMeaningfulNoteLine("<br>Gate code 4412<br>Dog barks")).toBe("Gate code 4412");
        });

        it("strips inline tags and collapses whitespace", () => {
            expect(firstMeaningfulNoteLine("<b>Gate</b>  code <i>4412</i>")).toBe("Gate code 4412");
        });

        it("skips a line that is only markup", () => {
            expect(firstMeaningfulNoteLine("<hr>\nGate code 4412")).toBe("Gate code 4412");
        });

        it("decodes the entities it handles", () => {
            expect(firstMeaningfulNoteLine("Ring&nbsp;bell &amp; wait")).toBe("Ring bell & wait");
        });
    });
});

describe("meaningfulNoteLines", () => {
    it("returns every line in order, trimmed", () => {
        expect(meaningfulNoteLines("\n  Gate code 4412  \nDog barks")).toEqual([
            "Gate code 4412",
            "Dog barks",
        ]);
    });

    it("returns empty array for undefined or blank input", () => {
        expect(meaningfulNoteLines(undefined)).toEqual([]);
        expect(meaningfulNoteLines("   \n  ")).toEqual([]);
    });

    it("skips boilerplate in the middle of the note", () => {
        expect(meaningfulNoteLines("Visit Type: PT11\nGate code 4412\nEmail: a@b.com")).toEqual([
            "Gate code 4412",
        ]);
    });

    it("caps at MAX_PROFILE_NOTE_LINES by default", () => {
        expect(meaningfulNoteLines("one\ntwo\nthree\nfour")).toEqual(["one", "two", "three"]);
    });

    it("respects an explicit max", () => {
        expect(meaningfulNoteLines("one\ntwo\nthree", 2)).toEqual(["one", "two"]);
        expect(meaningfulNoteLines("one\ntwo", 0)).toEqual([]);
    });

    it("splits on <br> tags", () => {
        expect(meaningfulNoteLines("<br>Gate code 4412<br>Dog barks")).toEqual([
            "Gate code 4412",
            "Dog barks",
        ]);
    });
});
