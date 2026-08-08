import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AlternateContact } from "../../utils/validation";
import { parseAlternateContactsField, serializeAlternateContactsField } from "../../api/sheets";
import { AlternateContactsEditor, cleanAlternateContacts } from "./AlternateContactsEditor";

afterEach(cleanup);

type ChangeHandler = Mock<(contacts: AlternateContact[]) => void>;

function renderEditor(contacts: AlternateContact[]): ChangeHandler {
    const onChange: ChangeHandler = vi.fn();
    render(<AlternateContactsEditor contacts={contacts} onChange={onChange} />);
    return onChange;
}

const addButton = () => screen.getByText("Add Contact");
const removeButtons = () => screen.getAllByLabelText("Remove contact");

describe("AlternateContactsEditor", () => {
    it("renders one prefilled row per contact", () => {
        renderEditor([
            { firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" },
            { firstName: "John", phone: "555-333-4444" },
        ]);

        expect(screen.getAllByPlaceholderText("Name").map((i) => (i as HTMLInputElement).value)).toEqual([
            "Mary",
            "John",
        ]);
        expect(screen.getAllByPlaceholderText("Phone").map((i) => (i as HTMLInputElement).value)).toEqual([
            "555-111-2222",
            "555-333-4444",
        ]);
        // A missing relationship renders as an empty input, not "undefined".
        expect(screen.getAllByPlaceholderText("Relation").map((i) => (i as HTMLInputElement).value)).toEqual([
            "Daughter",
            "",
        ]);
    });

    it("renders only the add button when there are no contacts", () => {
        renderEditor([]);

        expect(screen.queryByPlaceholderText("Name")).toBeNull();
        expect(addButton()).toBeDefined();
    });

    it("appends a blank row when Add Contact is clicked", () => {
        const onChange = renderEditor([{ firstName: "Mary", phone: "555-111-2222" }]);

        fireEvent.click(addButton());

        expect(onChange.mock.calls[0][0]).toEqual([
            { firstName: "Mary", phone: "555-111-2222" },
            { firstName: "", phone: "" },
        ]);
    });

    it("changes only the edited field of the edited row", () => {
        const onChange = renderEditor([
            { firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" },
            { firstName: "John", phone: "555-333-4444" },
        ]);

        fireEvent.change(screen.getAllByPlaceholderText("Phone")[1], { target: { value: "555-999-0000" } });

        expect(onChange.mock.calls[0][0]).toEqual([
            { firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" },
            { firstName: "John", phone: "555-999-0000" },
        ]);
    });

    it("removes the row whose trash button was clicked", () => {
        const onChange = renderEditor([
            { firstName: "Mary", phone: "555-111-2222" },
            { firstName: "John", phone: "555-333-4444" },
        ]);

        fireEvent.click(removeButtons()[0]);

        expect(onChange.mock.calls[0][0]).toEqual([{ firstName: "John", phone: "555-333-4444" }]);
    });

    it("leaves an empty list when the last row is removed — no forced blank row", () => {
        const onChange = renderEditor([{ firstName: "Mary", phone: "555-111-2222" }]);

        fireEvent.click(removeButtons()[0]);

        expect(onChange.mock.calls[0][0]).toEqual([]);
    });
});

describe("cleanAlternateContacts", () => {
    it("trims every field", () => {
        expect(
            cleanAlternateContacts([{ firstName: "  Mary  ", phone: "  555-111-2222 ", relationship: " Daughter " }])
        ).toEqual([{ firstName: "Mary", phone: "555-111-2222", relationship: "Daughter" }]);
    });

    it("drops rows missing a name or a phone", () => {
        expect(
            cleanAlternateContacts([
                { firstName: "NoPhone", phone: "   " },
                { firstName: "  ", phone: "555-000-0000" },
                { firstName: "Valid", phone: "555-222-2222" },
            ])
        ).toEqual([{ firstName: "Valid", phone: "555-222-2222" }]);
    });

    it("omits the relationship key entirely when it is blank", () => {
        // toEqual, not toMatchObject: a stray relationship:"" must fail here,
        // since it would make the modal's JSON change-detection see a false edit.
        expect(cleanAlternateContacts([{ firstName: "John", phone: "555-333-4444", relationship: "   " }])).toEqual([
            { firstName: "John", phone: "555-333-4444" },
        ]);
    });

    it("survives the Google Sheets round-trip unchanged", () => {
        const cleaned = cleanAlternateContacts([
            { firstName: " Mary ", phone: "555-111-2222", relationship: "Daughter" },
            { firstName: "John", phone: "555-333-4444", relationship: "" },
            { firstName: "Incomplete", phone: "" },
        ]);

        expect(parseAlternateContactsField(serializeAlternateContactsField(cleaned))).toEqual(cleaned);
    });
});
