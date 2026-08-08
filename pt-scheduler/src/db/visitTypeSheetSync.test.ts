import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./schema";
import type { VisitTypeDef } from "../types";
import { reconcileVisitTypesFromSheetSnapshot } from "./visitTypeSheetSync";
import { mergeVisitTypes } from "../stores/visitTypeStore";
import { BUILT_IN_VISIT_TYPE_CONFIGS } from "../utils/visitTypeColors";

const SPREADSHEET_ID = "sheet-123";
const TRACKED_KEY = `ptScheduler.sheetVisitTypeCodes.${SPREADSHEET_ID}`;

function makeDef(overrides: Partial<VisitTypeDef> & Pick<VisitTypeDef, "code">): VisitTypeDef {
    return {
        label: overrides.code,
        bg: "#112233",
        hidden: false,
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

beforeEach(async () => {
    await db.visitTypes.clear();
    await db.syncQueue.clear();
    window.localStorage.removeItem(TRACKED_KEY);
});

describe("reconcileVisitTypesFromSheetSnapshot", () => {
    it("upserts a custom type from the sheet", async () => {
        const result = await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [
            makeDef({ code: "PT26", label: "Wound Care" }),
        ]);

        expect(result.upserted).toBe(1);
        expect((await db.visitTypes.get("PT26"))?.label).toBe("Wound Care");
    });

    it("does not overwrite a code with a pending queue item", async () => {
        await db.visitTypes.put(makeDef({ code: "PT26", label: "Local Edit" }));
        await db.syncQueue.add({
            entity: "visitType",
            type: "update",
            data: { entityId: "PT26" },
            timestamp: new Date(),
            retryCount: 0,
            status: "pending",
        });

        await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [
            makeDef({ code: "PT26", label: "Remote Edit" }),
        ]);

        expect((await db.visitTypes.get("PT26"))?.label).toBe("Local Edit");
    });

    it("deletes a tracked custom code that is absent from the snapshot", async () => {
        await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [makeDef({ code: "PT26" })]);
        const result = await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, []);

        expect(result.deleted).toBe(1);
        expect(await db.visitTypes.get("PT26")).toBeUndefined();
    });

    it("drops a tracked built-in override and falls back to the frozen built-in", async () => {
        await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [
            makeDef({ code: "PT11", label: "Renamed", bg: "#ff0000" }),
        ]);
        expect(mergeVisitTypes(await db.visitTypes.toArray()).find((c) => c.code === "PT11")?.label)
            .toBe("Renamed");

        const result = await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, []);
        expect(result.deleted).toBe(1);

        const merged = mergeVisitTypes(await db.visitTypes.toArray());
        const pt11 = merged.find((c) => c.code === "PT11");
        const builtIn = BUILT_IN_VISIT_TYPE_CONFIGS.find((c) => c.code === "PT11");
        expect(pt11).toEqual(builtIn);
        // Built-ins are never stored, so the code itself survives any deletion.
        expect(merged.filter((c) => c.code === "PT11")).toHaveLength(1);
    });

    it("skips a malformed code", async () => {
        const result = await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [
            makeDef({ code: "!!!" }),
            makeDef({ code: "PT26" }),
        ]);

        expect(result.upserted).toBe(1);
        expect(await db.visitTypes.get("!!!")).toBeUndefined();
    });

    it("skips a row whose colour failed sheet validation", async () => {
        const result = await reconcileVisitTypesFromSheetSnapshot(SPREADSHEET_ID, [
            makeDef({ code: "PT26", bg: "red" }),
        ]);

        expect(result.upserted).toBe(0);
        expect(await db.visitTypes.get("PT26")).toBeUndefined();
    });
});
