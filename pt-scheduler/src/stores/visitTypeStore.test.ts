import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/schema";
import { BUILT_IN_VISIT_TYPE_CODES } from "../types";
import {
    useVisitTypeStore,
    mergeVisitTypes,
    isBuiltInVisitTypeCode,
} from "./visitTypeStore";
import { useSyncStore } from "./syncStore";
import {
    BUILT_IN_VISIT_TYPE_CONFIGS,
    getVisitTypeLabel,
    setVisitTypeRegistry,
} from "../utils/visitTypeColors";

const PT11 = BUILT_IN_VISIT_TYPE_CONFIGS.find((c) => c.code === "PT11")!;

const store = () => useVisitTypeStore.getState();
const codesOf = (configs: { code: string | null }[]) => configs.map((c) => c.code);

beforeEach(async () => {
    await db.visitTypes.clear();
    await db.syncQueue.clear();
    // No spreadsheet configured, so enqueueVisitTypeSync short-circuits and
    // these tests exercise the store/Dexie path without touching the queue.
    useSyncStore.setState({ spreadsheetId: "" });
    setVisitTypeRegistry(BUILT_IN_VISIT_TYPE_CONFIGS);
    useVisitTypeStore.setState({ stored: [], configs: [...BUILT_IN_VISIT_TYPE_CONFIGS] });
});

describe("mergeVisitTypes", () => {
    it("returns the frozen built-ins when nothing is stored", () => {
        expect(mergeVisitTypes([])).toEqual([...BUILT_IN_VISIT_TYPE_CONFIGS]);
    });

    it("ignores a stored row with a malformed code", () => {
        const merged = mergeVisitTypes([
            {
                code: "!!!",
                label: "Bad",
                bg: "#112233",
                hidden: false,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]);
        expect(merged).toEqual([...BUILT_IN_VISIT_TYPE_CONFIGS]);
    });

    it("orders customs after built-ins, by sortOrder then code", () => {
        const make = (code: string, sortOrder: number) => ({
            code,
            label: code,
            bg: "#112233",
            hidden: false,
            sortOrder,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const merged = mergeVisitTypes([make("PT30", 2), make("PT27", 1), make("PT26", 1)]);

        expect(codesOf(merged).slice(-3)).toEqual(["PT26", "PT27", "PT30"]);
        expect(codesOf(merged).slice(0, 12)).toEqual(codesOf([...BUILT_IN_VISIT_TYPE_CONFIGS]));
    });

    it("keeps a built-in's curated gradient when only the label changed", () => {
        const merged = mergeVisitTypes([
            {
                code: "PT11",
                label: "Renamed",
                bg: PT11.bg,
                hidden: false,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]);
        const pt11 = merged.find((c) => c.code === "PT11");
        expect(pt11?.label).toBe("Renamed");
        expect(pt11?.gradient).toBe(PT11.gradient);
    });

    it("derives a gradient when a built-in is recolored", () => {
        const merged = mergeVisitTypes([
            {
                code: "PT11",
                label: PT11.label,
                bg: "#112233",
                hidden: false,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]);
        expect(merged.find((c) => c.code === "PT11")?.gradient).toBe(
            "linear-gradient(135deg, #112233 0%, #0e1c2a 100%)"
        );
    });
});

describe("useVisitTypeStore", () => {
    it("writes an override row and repaints the registry", async () => {
        await store().save({ code: "PT11", label: "My Visits", bg: "#112233" });

        expect(await db.visitTypes.get("PT11")).toMatchObject({
            label: "My Visits",
            bg: "#112233",
        });
        // setVisitTypeRegistry ran, so the module-level accessors see it too.
        expect(getVisitTypeLabel("PT11")).toBe("My Visits");
    });

    it("uppercases the code so the Dexie key matches the sheet row", async () => {
        await store().save({ code: "pt26", label: "Wound Care", bg: "#112233" });

        expect(await db.visitTypes.get("PT26")).toBeDefined();
        expect(await db.visitTypes.get("pt26")).toBeUndefined();
    });

    it("lowercases the colour", async () => {
        await store().save({ code: "PT26", label: "Wound Care", bg: "#AABBCC" });
        expect((await db.visitTypes.get("PT26"))?.bg).toBe("#aabbcc");
    });

    it("treats remove on a built-in as a reset to the frozen default", async () => {
        await store().save({ code: "PT11", label: "My Visits", bg: "#112233" });
        await store().remove("PT11");

        expect(await db.visitTypes.get("PT11")).toBeUndefined();
        expect(store().configs.find((c) => c.code === "PT11")).toEqual(PT11);
        expect(getVisitTypeLabel("PT11")).toBe("Regular Visit");
    });

    it("round-trips hide then reset", async () => {
        await store().setHidden("PT00", true);
        expect(store().configs.find((c) => c.code === "PT00")?.hidden).toBe(true);
        // Hiding a pristine built-in creates an override row, which is what
        // makes the Reset button become enabled.
        expect(await db.visitTypes.get("PT00")).toBeDefined();

        await store().remove("PT00");
        expect(store().configs.find((c) => c.code === "PT00")?.hidden).toBeUndefined();
        expect(await db.visitTypes.get("PT00")).toBeUndefined();
    });

    it("preserves the label and colour when hiding", async () => {
        await store().save({ code: "PT11", label: "My Visits", bg: "#112233" });
        await store().setHidden("PT11", true);

        expect(await db.visitTypes.get("PT11")).toMatchObject({
            label: "My Visits",
            bg: "#112233",
            hidden: true,
        });
    });

    it("removes a custom type entirely", async () => {
        await store().save({ code: "PT26", label: "Wound Care", bg: "#112233" });
        expect(codesOf(store().configs)).toContain("PT26");

        await store().remove("PT26");
        expect(codesOf(store().configs)).not.toContain("PT26");
        expect(await db.visitTypes.get("PT26")).toBeUndefined();
    });

    it("never drops a built-in code, whatever sequence of calls runs", async () => {
        for (const code of BUILT_IN_VISIT_TYPE_CODES) {
            await store().save({ code, label: "x", bg: "#000000" });
            await store().setHidden(code, true);
            await store().remove(code);
        }

        expect(await db.visitTypes.count()).toBe(0);
        expect(codesOf(store().configs)).toEqual(codesOf([...BUILT_IN_VISIT_TYPE_CONFIGS]));
        expect(store().configs).toEqual([...BUILT_IN_VISIT_TYPE_CONFIGS]);
    });

    it("loads stored rows back into the registry", async () => {
        await store().save({ code: "PT26", label: "Wound Care", bg: "#112233" });
        useVisitTypeStore.setState({ stored: [], configs: [...BUILT_IN_VISIT_TYPE_CONFIGS] });

        await store().loadAll();

        expect(codesOf(store().configs)).toContain("PT26");
    });
});

describe("isBuiltInVisitTypeCode", () => {
    it("recognises built-ins and rejects custom codes", () => {
        expect(isBuiltInVisitTypeCode("PT18")).toBe(true);
        expect(isBuiltInVisitTypeCode("NOMNC")).toBe(true);
        expect(isBuiltInVisitTypeCode("PT26")).toBe(false);
    });
});
