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

export function buildOCRPrompt(targetWeekStart: string): { system: string; userPrefix: string } {
  const weekStart = new Date(targetWeekStart + "T00:00:00");
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const formatDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = (d: Date) => dayNames[d.getDay()];

  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekEnd);

  return {
    system: `You are an appointment extraction assistant for a home health physical therapy scheduling app.
You will receive an image of a weekly schedule screenshot (typically from a staffing agency portal).
Extract every appointment you can identify.

DATE CONTEXT (critical — use this to resolve dates):
- Today's date: ${formatDate(new Date())}
- Target week: ${dayName(weekStart)} ${weekStartStr} through ${dayName(weekEnd)} ${weekEndStr}
- If the screenshot shows day numbers (e.g. 23, 24, 25) or day names (Monday, Tuesday...), resolve them to full YYYY-MM-DD dates within the target week above.
- If no start times are shown, assign sequential times starting at 09:00 with 60-minute gaps for each patient on the same day.

Rules:
- Extract patient name exactly as shown (do not correct spelling).
- If a visit type/code appears before the name (examples: "PT11", "PT 11", "EVAL", "NOMNC"), extract it as visitType.
- For rows like "PT33 - LAST, FIRST", set visitType to "PT33" and rawName to "LAST, FIRST" (without the code prefix).
- For rows like "NOMNC - LAST, FIRST", set visitType to "NOMNC" and rawName to "LAST, FIRST" (without the code prefix).
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
