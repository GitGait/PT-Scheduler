import { describe, expect, it } from "vitest";
import { parseAlternateContactsField, serializeAlternateContactsField } from "./sheets";

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
