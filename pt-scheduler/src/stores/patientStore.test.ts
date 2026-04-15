import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/schema";
import { patientDB } from "../db/operations";

// Mock syncStore so the store's hasSpreadsheetSyncConfigured() returns false
// (no sync queue writes needed for these unit tests).
vi.mock("./syncStore", () => ({
    useSyncStore: {
        getState: () => ({
            spreadsheetId: "",
            refreshPendingCount: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

// Mock syncQueueDB so enqueuePatientSync short-circuits before reaching it.
vi.mock("../db/operations", async (importOriginal) => {
    const real = await importOriginal<typeof import("../db/operations")>();
    return {
        ...real,
        syncQueueDB: {
            add: vi.fn().mockResolvedValue(1),
        },
    };
});

import { usePatientStore } from "./patientStore";

const basePatient = {
    fullName: "Doe, John",
    nicknames: [],
    phoneNumbers: [],
    alternateContacts: [],
    address: "123 Main St",
    status: "active" as const,
    notes: "",
};

describe("usePatientStore.update — lat/lng auto-clear", () => {
    beforeEach(async () => {
        await db.patients.clear();
        vi.clearAllMocks();
        usePatientStore.setState({ patients: [], loading: false, error: null, searchQuery: "" });
    });

    it("clears lat/lng when address changes without explicit coords", async () => {
        // Seed patient with coords
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { address: "456 Oak Ave" });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBeUndefined();
        expect(saved?.lng).toBeUndefined();
        expect(saved?.address).toBe("456 Oak Ave");
    });

    it("does NOT clear coords when updating fields other than address", async () => {
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { notes: "x" });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBe(40);
        expect(saved?.lng).toBe(-74);
    });

    it("preserves explicit new coords when address and coords both change", async () => {
        const id = await patientDB.add({ ...basePatient, lat: 40, lng: -74 });

        await usePatientStore.getState().update(id, { address: "789 Pine Rd", lat: 41, lng: -75 });

        const saved = await patientDB.get(id);
        expect(saved?.lat).toBe(41);
        expect(saved?.lng).toBe(-75);
        expect(saved?.address).toBe("789 Pine Rd");
    });
});
