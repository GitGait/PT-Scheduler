import { describe, expect, it } from "vitest";
import {
    parseAlternateContactsField,
    serializeAlternateContactsField,
    serializeAdditionalPhonesField,
    parseAdditionalPhonesField,
    parseVisitTypeRow,
    buildVisitTypeRowForHeaders,
} from "./sheets";
import type { VisitTypeDef } from "../types";

describe("sheets alternate contacts", () => {
  it("parses alternate contacts with relationship", () => {
    const parsed = parseAlternateContactsField(
      "Mary|555-111-2222|Daughter; John|555-333-4444|Spouse"
    );

    expect(parsed).toEqual([
      { firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" },
      { firstName: "John", phone: "555-333-4444", relationship: "Spouse" }
    ]);
  });

  it("parses alternate contacts without relationship", () => {
    const parsed = parseAlternateContactsField("Alex|555-123-9999");

    expect(parsed).toEqual([{ firstName: "Alex", phone: "555-123-9999" }]);
  });

  it("ignores invalid entries", () => {
    const parsed = parseAlternateContactsField("MissingPhone||Daughter; |555-0000|Sibling; Valid|555-2222");

    expect(parsed).toEqual([{ firstName: "Valid", phone: "555-2222" }]);
  });

  it("serializes alternate contacts", () => {
    const serialized = serializeAlternateContactsField([
      { firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" },
      { firstName: "John", phone: "555-333-4444" }
    ]);

    expect(serialized).toBe("Mary|555-111-2222|Daughter; John|555-333-4444");
  });
});

describe("sheets additional phones", () => {
    it("serializes additional phone numbers with labels", () => {
        const result = serializeAdditionalPhonesField([
            { number: "555-0000" },
            { number: "555-1111", label: "Cell" },
            { number: "555-2222", label: "Home" },
        ]);
        expect(result).toBe("Cell:555-1111; Home:555-2222");
    });

    it("serializes additional phones without labels", () => {
        const result = serializeAdditionalPhonesField([
            { number: "555-0000" },
            { number: "555-1111" },
        ]);
        expect(result).toBe("555-1111");
    });

    it("returns empty string when only primary exists", () => {
        expect(serializeAdditionalPhonesField([{ number: "555-0000" }])).toBe("");
        expect(serializeAdditionalPhonesField([])).toBe("");
    });

    it("parses additional phones with labels", () => {
        const result = parseAdditionalPhonesField("Cell:555-1111; Home:555-2222");
        expect(result).toEqual([
            { number: "555-1111", label: "Cell" },
            { number: "555-2222", label: "Home" },
        ]);
    });

    it("parses additional phones without labels", () => {
        const result = parseAdditionalPhonesField("555-1111; 555-2222");
        expect(result).toEqual([
            { number: "555-1111" },
            { number: "555-2222" },
        ]);
    });

    it("returns empty array for empty string", () => {
        expect(parseAdditionalPhonesField("")).toEqual([]);
        expect(parseAdditionalPhonesField("  ")).toEqual([]);
    });
});

describe("visit type sheet rows", () => {
    const HEADERS = [
        "code",
        "label",
        "color",
        "hidden",
        "sortOrder",
        "isBuiltIn",
        "updatedAt",
    ];

    const def: VisitTypeDef = {
        code: "PT26",
        label: "Wound Care",
        bg: "#112233",
        hidden: false,
        sortOrder: 3,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
    };

    it("round-trips a custom type", () => {
        const row = buildVisitTypeRowForHeaders(HEADERS, def);
        const parsed = parseVisitTypeRow(HEADERS, row);

        expect(parsed).toMatchObject({
            code: "PT26",
            label: "Wound Care",
            bg: "#112233",
            hidden: false,
            sortOrder: 3,
        });
    });

    it("parses regardless of header order", () => {
        const permuted = ["updatedAt", "hidden", "label", "code", "isBuiltIn", "sortOrder", "color"];
        const row = buildVisitTypeRowForHeaders(permuted, def);
        const parsed = parseVisitTypeRow(permuted, row);

        expect(parsed).toMatchObject({ code: "PT26", label: "Wound Care", bg: "#112233" });
    });

    it("rejects a blank code", () => {
        expect(parseVisitTypeRow(HEADERS, ["", "Label", "#112233", "", "", "", ""])).toBeNull();
    });

    it("uppercases a lowercase code", () => {
        expect(parseVisitTypeRow(HEADERS, ["pt26", "Label", "#112233", "", "", "", ""])?.code).toBe(
            "PT26"
        );
    });

    it("rejects a code containing a space", () => {
        expect(
            parseVisitTypeRow(HEADERS, ["PT 26", "Label", "#112233", "", "", "", ""])
        ).toBeNull();
    });

    it("reads hidden from TRUE/true/1 and treats blank as false", () => {
        const hiddenOf = (raw: string) =>
            parseVisitTypeRow(HEADERS, ["PT26", "Label", "#112233", raw, "", "", ""])?.hidden;

        expect(hiddenOf("TRUE")).toBe(true);
        expect(hiddenOf("true")).toBe(true);
        expect(hiddenOf("1")).toBe(true);
        expect(hiddenOf("yes")).toBe(true);
        expect(hiddenOf("")).toBe(false);
        expect(hiddenOf("FALSE")).toBe(false);
    });

    it("ignores the isBuiltIn cell so a hand-edited sheet can't make PT18 deletable", () => {
        const parsed = parseVisitTypeRow(HEADERS, [
            "PT18",
            "OASIS Discharge",
            "#fb8c00",
            "",
            "",
            "FALSE",
            "",
        ]);

        expect(parsed?.code).toBe("PT18");
        expect(parsed).not.toHaveProperty("isBuiltIn");
    });

    it("writes isBuiltIn for humans based on the compiled-in list", () => {
        const builtIn: VisitTypeDef = { ...def, code: "PT18" };
        expect(buildVisitTypeRowForHeaders(HEADERS, builtIn)[5]).toBe("TRUE");
        expect(buildVisitTypeRowForHeaders(HEADERS, def)[5]).toBe("FALSE");
    });

    it("falls back to the default colour rather than storing a raw cell", () => {
        const parsed = parseVisitTypeRow(HEADERS, ["PT26", "Label", "red", "", "", "", ""]);
        expect(parsed?.bg).toBe("#b0bec5");
    });
});
