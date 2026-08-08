import { describe, it, expect, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/schema";
import type { Appointment, Patient, VisitTypeDef } from "../types";
import { processAutoDischarges } from "./useAutoDischarge";
import { setVisitTypeRegistry, BUILT_IN_VISIT_TYPE_CONFIGS } from "../utils/visitTypeColors";
import { mergeVisitTypes } from "../stores/visitTypeStore";

function isoDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
}

async function seedPatientWithVisit(visitType: string): Promise<string> {
    const patientId = uuidv4();
    const patient: Patient = {
        id: patientId,
        fullName: "Test Patient",
        nicknames: [],
        phoneNumbers: [],
        alternateContacts: [],
        address: "",
        status: "active",
        notes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await db.patients.put(patient);

    const appointment: Appointment = {
        id: uuidv4(),
        patientId,
        // 14 days back guarantees that week's Saturday has passed.
        date: isoDaysAgo(14),
        startTime: "09:00",
        duration: 60,
        status: "completed",
        syncStatus: "local",
        visitType,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await db.appointments.put(appointment);

    return patientId;
}

beforeEach(async () => {
    await db.patients.clear();
    await db.appointments.clear();
    await db.visitTypes.clear();
    setVisitTypeRegistry(BUILT_IN_VISIT_TYPE_CONFIGS);
});

describe("processAutoDischarges", () => {
    it("discharges on PT18 even when it is recolored, relabelled and hidden", async () => {
        // Auto-discharge compares codes, never labels or colours, so a fully
        // customized PT18 must still trigger it.
        const override: VisitTypeDef = {
            code: "PT18",
            label: "My Own Name",
            bg: "#123456",
            hidden: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await db.visitTypes.put(override);
        setVisitTypeRegistry(mergeVisitTypes([override]));

        const patientId = await seedPatientWithVisit("PT18");

        expect(await processAutoDischarges()).toBe(1);
        expect((await db.patients.get(patientId))?.status).toBe("discharged");
    });

    it("does not discharge on an unrelated custom code", async () => {
        const patientId = await seedPatientWithVisit("PT26");

        expect(await processAutoDischarges()).toBe(0);
        expect((await db.patients.get(patientId))?.status).toBe("active");
    });
});
