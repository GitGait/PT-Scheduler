# Phase 4: Serverless Functions (Vercel)

> Goal: implement OCR, optimize, geocode, extraction, and AI matching endpoints with validation/error contracts.

## Prerequisites

- Phases 0-3.5 complete
- API keys configured in env

## Endpoints (`api/`)

- `ocr.ts`
- `optimize.ts`
- `extract-patient.ts`
- `match-patient.ts`
- `geocode.ts`

## Requirements

- Validate request body shape early (return 400).
- Validate upstream API response before parse/use.
- Use stable error payload shape (`error`, `code`).
- Return only validated JSON payloads.
- Add request timeout via `AbortController`.
- Only accept POST requests (return 405 for others).
- Validate that required env vars exist at startup (see helpers below).

## CORS Helper (`api/_cors.ts`)

Every endpoint must handle CORS. Create a shared helper:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",           // Vite dev server
  process.env.PRODUCTION_URL         // e.g. "https://pt-scheduler.vercel.app"
].filter(Boolean) as string[];

export function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin ?? "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true; // signal caller to return early
  }
  return false;
}
```

Call `if (cors(req, res)) return;` at the top of every endpoint handler.

## Environment Variable Guard (`api/_env.ts`)

Fail fast if keys are missing:

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
```

Use in endpoints: `const apiKey = requireEnv("OPENAI_API_KEY");`

## Client Helpers (`src/api/`)

Add:
- `ocr.ts`
- `optimize.ts`
- `extract.ts`
- `geocode.ts`

All helpers should:
- call `assertOk`
- parse JSON
- validate via `parseWithSchema`

## Verification

- each endpoint succeeds with valid input
- invalid input returns 400
- upstream failure returns 502 with clear code
- OPTIONS preflight returns 204 with correct CORS headers
- missing env var produces clear startup error

## Next Phase

-> **[Phase_5_UI_Components.md](./Phase_5_UI_Components.md)**
