import { fetchJsonWithTimeout } from "./request";
import { extractPatientResponseSchema, parseWithSchema } from "../utils/validation";

/**
 * Extract structured patient info from referral text using AI.
 */
export async function extractPatient(referralText: string) {
    const payload = await fetchJsonWithTimeout<unknown>(
        "/api/extract-patient",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ referralText })
        },
        "Patient extraction failed"
    );

    return parseWithSchema(extractPatientResponseSchema, payload, "extractPatient");
}
