/**
 * AI prompt templates for patient matching and OCR extraction.
 *
 * This file is in /api/ (serverless functions) and is NEVER bundled into
 * the client application. Import these only from serverless endpoints.
 */

// ---------------------------------------------------------------------------
// Patient name matching prompt
// ---------------------------------------------------------------------------

export function buildMatchPrompt(
  ocrName: string,
  candidateNames: string[]
): { system: string; user: string } {
  return {
    system: `You are a patient-name matching assistant for a home health PT scheduling app.
You will receive a name extracted from an OCR screenshot and a list of known patient names.
Your job is to determine which known patient (if any) is the best match.

Rules:
- Account for OCR errors: misread characters, missing letters, swapped letters.
- Account for nicknames: "Bob" = "Robert", "Bill" = "William", etc.
- Account for "Last, First" vs "First Last" ordering.
- Return ONLY valid JSON — no markdown, no explanation.
- If no candidate is a reasonable match, return null for matchedName and 0 for confidence.

Response format (strict JSON):
{
  "matchedName": "<exact string from candidate list or null>",
  "confidence": <integer 0-100>
}`,

    user: `OCR extracted name: "${ocrName}"

Known patients:
${candidateNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Which patient is the best match? Respond with JSON only.`
  };
}

// ---------------------------------------------------------------------------
// OCR screenshot extraction prompt
// ---------------------------------------------------------------------------

export function buildOCRPrompt(): { system: string; userPrefix: string } {
  return {
    system: `You are an appointment extraction assistant for a home health physical therapy scheduling app.
You will receive an image of a weekly schedule screenshot (typically from a staffing agency portal).
Extract every appointment you can identify.

Rules:
- Extract patient name exactly as shown (do not correct spelling).
- If a visit type/code appears before the name (examples: "PT11", "PT 11", "EVAL"), extract it as visitType.
- For rows like "PT33 - LAST, FIRST", set visitType to "PT33" and rawName to "LAST, FIRST" (without the code prefix).
- Extract date in YYYY-MM-DD format.
- Extract start time in HH:mm (24-hour) format.
- Estimate duration in minutes. Default to 60 if not shown.
- If any field is uncertain, set "uncertain": true on that entry.
- Return ONLY valid JSON — no markdown, no explanation.

Response format (strict JSON):
{
  "appointments": [
    {
      "rawName": "string",
      "visitType": "string",
      "date": "YYYY-MM-DD",
      "time": "HH:mm",
      "duration": number,
      "uncertain": boolean
    }
  ]
}`,

    userPrefix: "Extract all appointments from this schedule screenshot:"
  };
}

// ---------------------------------------------------------------------------
// Patient info extraction from referral text
// ---------------------------------------------------------------------------

export function buildExtractPatientPrompt(referralText: string): {
  system: string;
  user: string;
} {
  return {
    system: `You are a patient information extraction assistant for a home health PT scheduling app.
You will receive raw referral text (pasted from an email, fax, or document).
Extract structured patient information from the text.

Rules:
- Extract what you can find. Use empty string "" for missing fields.
- Phone numbers should be digits only with dashes: "555-123-4567".
- Address should be a single line suitable for geocoding.
- alternateContacts is an array; return [] if none found.
- Return ONLY valid JSON — no markdown, no explanation.

Response format (strict JSON):
{
  "fullName": "Last, First",
  "phone": "555-123-4567",
  "alternateContacts": [
    { "firstName": "string", "phone": "string" }
  ],
  "address": "123 Main St, City, ST 12345",
  "email": "",
  "notes": "any other relevant info from the referral"
}`,

    user: `Extract patient information from this referral:\n\n${referralText}`
  };
}

// ---------------------------------------------------------------------------
// CSV column mapping prompt
// ---------------------------------------------------------------------------

export function buildCsvMappingPrompt(
  headers: string[],
  sampleRows: string[][]
): { system: string; user: string } {
  const headerList = headers.map((header, index) => `${index + 1}. ${header}`).join("\n");
  const samples = sampleRows
    .slice(0, 20)
    .map((row, rowIndex) => {
      const pairs = headers.map((header, index) => `${header}: ${row[index] ?? ""}`).join(" | ");
      return `Row ${rowIndex + 1}: ${pairs}`;
    })
    .join("\n");

  return {
    system: `You map source CSV columns to a target patient schema for a PT scheduling app.
Map each target field to exactly one source header name or null if unavailable.
Prefer high-confidence practical mappings based on headers and sample data.
Do not invent headers that are not in the provided list.
Return ONLY strict JSON with this shape:
{
  "mapping": {
    "id": string | null,
    "fullName": string | null,
    "nicknames": string | null,
    "phone": string | null,
    "alternateContacts": string | null,
    "address": string | null,
    "lat": string | null,
    "lng": string | null,
    "status": string | null,
    "notes": string | null,
    "email": string | null
  },
  "confidence": {
    "<targetField>": number between 0 and 1
  }
}`,
    user: `Source headers:\n${headerList}\n\nSample rows:\n${samples || "(none)"}
\nDetermine the best mapping.`,
  };
}
