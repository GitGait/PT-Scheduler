import { describe, it, expect, beforeEach } from "vitest";
import {
    useUndoStore,
    recordUndo,
    runWithoutUndo,
    beginUndoBatch,
    endUndoBatch,
    abortUndoBatch,
    resolveUndoId,
    labelFor,
    inferUpdateReason,
    UNDO_STACK_LIMIT,
    __resetUndoModuleState,
    type UndoBatchEntry,
    type UndoUpdateEntry,
    type UndoPatientEntry,
} from "./undoStore";

function updateInput(appointmentId: string, startTime = "09:00") {
    return {
        kind: "update" as const,
        reason: "move" as const,
        appointmentId,
        before: { startTime },
        after: { startTime: "10:00" },
    };
}

describe("undoStore", () => {
    beforeEach(() => {
        useUndoStore.getState().clearHistory();
        __resetUndoModuleState();
    });

    describe("stack limit", () => {
        it("keeps only the last 20 entries, dropping the oldest", () => {
            for (let i = 0; i < 21; i += 1) {
                recordUndo(updateInput(`appt-${i}`));
            }

            const { entries } = useUndoStore.getState();
            expect(entries).toHaveLength(UNDO_STACK_LIMIT);
            expect((entries[0] as UndoUpdateEntry).appointmentId).toBe("appt-1");
            expect((entries[19] as UndoUpdateEntry).appointmentId).toBe("appt-20");
        });

        it("pops newest-first and empties out", () => {
            recordUndo(updateInput("a"));
            recordUndo(updateInput("b"));

            expect((useUndoStore.getState().pop() as UndoUpdateEntry).appointmentId).toBe("b");
            expect((useUndoStore.getState().pop() as UndoUpdateEntry).appointmentId).toBe("a");
            expect(useUndoStore.getState().pop()).toBeUndefined();
        });
    });

    describe("runWithoutUndo", () => {
        it("suppresses records made inside the callback", async () => {
            await runWithoutUndo(async () => {
                recordUndo(updateInput("a"));
                recordUndo(updateInput("b"));
            });

            expect(useUndoStore.getState().entries).toHaveLength(0);
        });

        it("restores the counter when the callback throws", async () => {
            await expect(
                runWithoutUndo(async () => {
                    recordUndo(updateInput("a"));
                    throw new Error("boom");
                })
            ).rejects.toThrow("boom");

            // Suppression must not leak past the throw.
            recordUndo(updateInput("b"));
            expect(useUndoStore.getState().entries).toHaveLength(1);
        });

        it("restores the counter when nested", async () => {
            await runWithoutUndo(async () => {
                await runWithoutUndo(async () => {
                    recordUndo(updateInput("a"));
                });
                recordUndo(updateInput("b"));
            });
            expect(useUndoStore.getState().entries).toHaveLength(0);

            recordUndo(updateInput("c"));
            expect(useUndoStore.getState().entries).toHaveLength(1);
        });
    });

    describe("batching", () => {
        it("collapses 3 records into one batch entry with 3 children", () => {
            beginUndoBatch("clear-week", "Cleared 3 appointments");
            recordUndo(updateInput("a"));
            recordUndo(updateInput("b"));
            recordUndo(updateInput("c"));
            endUndoBatch();

            const { entries } = useUndoStore.getState();
            expect(entries).toHaveLength(1);

            const batch = entries[0] as UndoBatchEntry;
            expect(batch.kind).toBe("batch");
            expect(batch.source).toBe("clear-week");
            expect(batch.label).toBe("Cleared 3 appointments");
            expect(batch.children).toHaveLength(3);
            expect(batch.children.map((c) => (c as UndoUpdateEntry).appointmentId)).toEqual(["a", "b", "c"]);
        });

        it("dedupes by target id, keeping the FIRST snapshot", () => {
            beginUndoBatch("clear-week", "Cleared 1 appointment");
            recordUndo(updateInput("a", "08:00"));
            recordUndo(updateInput("a", "11:00"));
            endUndoBatch();

            const batch = useUndoStore.getState().entries[0] as UndoBatchEntry;
            expect(batch.children).toHaveLength(1);
            expect((batch.children[0] as UndoUpdateEntry).before.startTime).toBe("08:00");
        });

        it("dedupes patients and appointments in separate namespaces", () => {
            beginUndoBatch("multi", "Note updated");
            recordUndo({ kind: "patient", patientId: "p1", before: { chipNote: "old" }, after: { chipNote: "new" } });
            recordUndo({ kind: "patient", patientId: "p1", before: { chipNote: "mid" }, after: { chipNote: "new" } });
            // Same raw id, different table — must NOT be swallowed by the patient entry.
            recordUndo(updateInput("p1"));
            endUndoBatch();

            const batch = useUndoStore.getState().entries[0] as UndoBatchEntry;
            expect(batch.children).toHaveLength(2);
            expect(batch.children.map((c) => c.kind)).toEqual(["patient", "update"]);
            // The repeated patient write still collapsed to its first snapshot.
            expect((batch.children[0] as UndoPatientEntry).before.chipNote).toBe("old");
        });

        it("pushes nothing for an empty batch", () => {
            beginUndoBatch("auto-arrange", "Day auto-arranged");
            endUndoBatch();

            expect(useUndoStore.getState().entries).toHaveLength(0);
        });

        it("ignores nested begins and only closes on the outermost end", () => {
            beginUndoBatch("clear-week", "outer");
            beginUndoBatch("multi", "inner");
            recordUndo(updateInput("a"));
            endUndoBatch();

            expect(useUndoStore.getState().entries).toHaveLength(0);

            recordUndo(updateInput("b"));
            endUndoBatch();

            const entries = useUndoStore.getState().entries;
            expect(entries).toHaveLength(1);
            expect((entries[0] as UndoBatchEntry).label).toBe("outer");
            expect((entries[0] as UndoBatchEntry).children).toHaveLength(2);
        });

        it("abortUndoBatch discards everything collected", () => {
            beginUndoBatch("clear-week", "Cleared 2 appointments");
            recordUndo(updateInput("a"));
            recordUndo(updateInput("b"));
            abortUndoBatch();

            expect(useUndoStore.getState().entries).toHaveLength(0);

            // The batch is closed — later records go straight onto the stack.
            recordUndo(updateInput("c"));
            expect(useUndoStore.getState().entries).toHaveLength(1);
            expect(useUndoStore.getState().entries[0].kind).toBe("update");
        });
    });

    describe("resolveUndoId", () => {
        it("follows a chain A -> B -> C", () => {
            useUndoStore.getState().registerRemap("A", "B");
            useUndoStore.getState().registerRemap("B", "C");

            expect(resolveUndoId("A")).toBe("C");
        });

        it("returns the id unchanged when unmapped", () => {
            expect(resolveUndoId("nope")).toBe("nope");
        });

        it("terminates on a self-cycle", () => {
            useUndoStore.getState().registerRemap("A", "A");
            expect(resolveUndoId("A")).toBe("A");
        });

        it("terminates on a two-node cycle", () => {
            useUndoStore.getState().registerRemap("A", "B");
            useUndoStore.getState().registerRemap("B", "A");
            expect(resolveUndoId("A")).toBe("B");
        });

        it("holds the depth cap on a long chain", () => {
            for (let i = 0; i < 40; i += 1) {
                useUndoStore.getState().registerRemap(`id-${i}`, `id-${i + 1}`);
            }
            // Capped at UNDO_STACK_LIMIT hops rather than walking all 40.
            expect(resolveUndoId("id-0")).toBe(`id-${UNDO_STACK_LIMIT}`);
        });
    });

    describe("labels", () => {
        it("derives text from kind and reason", () => {
            expect(labelFor({ kind: "create", appointmentId: "a" })).toBe("Appointment added");
            expect(labelFor({ kind: "hold", appointmentId: "a", previousStatus: "scheduled" })).toBe("Moved to On Hold");
            expect(labelFor({ ...updateInput("a"), reason: "move" })).toBe("Appointment moved");
            expect(labelFor({ ...updateInput("a"), reason: "resize" })).toBe("Duration changed");
            expect(labelFor({ ...updateInput("a"), reason: "note" })).toBe("Note updated");
            expect(labelFor({ ...updateInput("a"), reason: "detail" })).toBe("Appointment updated");
        });

        it("infers the reason from changed keys, most-specific first", () => {
            expect(inferUpdateReason(["startTime"])).toBe("move");
            expect(inferUpdateReason(["date"])).toBe("move");
            expect(inferUpdateReason(["date", "duration"])).toBe("move");
            expect(inferUpdateReason(["duration"])).toBe("resize");
            expect(inferUpdateReason(["chipNotes"])).toBe("note");
            expect(inferUpdateReason(["notes"])).toBe("note");
            expect(inferUpdateReason(["visitType"])).toBe("detail");
        });
    });

    it("stamps every recorded entry with an id, timestamp and label", () => {
        recordUndo(updateInput("a"));
        const entry = useUndoStore.getState().entries[0];

        expect(entry.entryId).toMatch(/^[0-9a-f-]{36}$/);
        expect(entry.at).toBeGreaterThan(0);
        expect(entry.label).toBe("Appointment moved");
    });

    it("clearHistory drops entries and the remap map", () => {
        recordUndo(updateInput("a"));
        useUndoStore.getState().registerRemap("A", "B");
        useUndoStore.getState().clearHistory();

        expect(useUndoStore.getState().entries).toHaveLength(0);
        expect(resolveUndoId("A")).toBe("A");
    });
});
