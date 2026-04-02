import { describe, expect, it } from "vitest";
import {
    parseAlternateContactsField,
    serializeAlternateContactsField,
    serializeAdditionalPhonesField,
    parseAdditionalPhonesField,
} from "./sheets";

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
