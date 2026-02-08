# Phase 3: Patient Matching

> Goal: implement 3-stage matching for OCR names.

## Prerequisites

- Phases 0-2 complete

## Matching Utility (`src/utils/matching.ts`)

Implement three stages run in sequence. Stop as soon as one returns confidence >= 70.

### Stage 1: Exact + Nickname (scaffold provided)

Use the scaffold's `matchCandidate()` from `src/utils/matching.ts`. This does token-based matching with nickname expansion (e.g. "Bob" ↔ "Robert"). If confidence >= 90, return immediately as tier `auto`.

### Stage 2: Fuzzy (Fuse.js)

If stage 1 confidence < 90, run a Fuse.js search over `fullName` and `nicknames` fields. Configure with:

```ts
const fuse = new Fuse(candidates, {
  keys: [
    { name: "fullName", weight: 0.7 },
    { name: "nicknames", weight: 0.3 }
  ],
  threshold: 0.4,
  includeScore: true
});
```

Convert Fuse score (0 = perfect, 1 = worst) to confidence: `Math.round((1 - score) * 100)`. This catches OCR typos that token matching misses.

### Stage 3: AI fallback

If best confidence from stages 1-2 is still < 70, POST to `/api/match-patient` using the prompt from `aiMatchPrompt.ts`.

### Return shape

```ts
interface MatchResult {
  candidate: MatchCandidate | null;
  confidence: number;
  alternatives: { candidate: MatchCandidate; confidence: number }[];
  tier: "auto" | "confirm" | "manual";
}
```

Tier thresholds:
- `auto`: confidence >= 90 (apply without user review)
- `confirm`: confidence 70-89 (show to user for confirmation)
- `manual`: confidence < 70 (user must pick or type manually)

## AI Match Prompt (`src/utils/aiMatchPrompt.ts`)

This file is provided in the scaffold. It exports three prompt builders:

- `buildMatchPrompt(ocrName, candidateNames)` — returns `{ system, user }` for the `/api/match-patient` endpoint. Instructs GPT-4o Mini to account for OCR errors, nicknames, and name ordering, returning `{ matchedName, confidence }` as strict JSON.
- `buildOCRPrompt()` — returns `{ system, userPrefix }` for the `/api/ocr` endpoint. Instructs the model to extract appointments from a screenshot image, returning `{ appointments: ExtractedAppointment[] }`.
- `buildExtractPatientPrompt(referralText)` — returns `{ system, user }` for the `/api/extract-patient` endpoint. Extracts structured patient info from pasted referral text.

All prompts enforce strict JSON-only responses (no markdown wrapping) and use the Zod schemas from `validation.ts` as the source of truth for response shapes.

## Verification

- `Bob` can match `Robert`.
- Typo names still return best candidate + alternatives.
- Low-confidence paths trigger AI fallback.

## Next Phase

-> **[Phase_3_5_Hardening.md](./Phase_3_5_Hardening.md)**
