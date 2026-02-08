# Phase 3.5: Hardening (Validation, Errors, Sync Reliability)

> Goal: add runtime validation, consistent error contracts, and queue reliability before external API integration.

## Prerequisites

- Phases 0-3 complete

## 3.5.1 Add runtime validation

> Zod was already installed in Phase 0. No additional install needed.

Create `src/utils/validation.ts` with schemas for:
- OCR response
- route optimization response
- geocode response
- AI match response
- extract patient response

Add `parseWithSchema(schema, data, context)` helper.

## 3.5.2 Standardize API errors

Create `src/utils/apiError.ts`:
- `ApiError`
- `assertOk(res, fallbackMessage)`
- stable error payload format (`error`, `code`, optional `details`)

## 3.5.3 Global error boundary

Create `src/components/ui/ErrorBoundary.tsx` and wrap app routes.

## 3.5.4 Queue retry + idempotency baseline

Update `SyncQueueItem` and queue operations:
- `retryCount`
- `lastError`
- `nextRetryAt`
- `idempotencyKey`

Rules:
- exponential backoff (`1s`, `2s`, `4s`, ... max `60s`)
- max retries `5`, then status `failed`
- preserve idempotency key for create operations

## 3.5.5 Add automated tests

Add:
- `src/utils/validation.test.ts`
- `src/utils/matching.test.ts`
- `src/hooks/syncQueue.test.ts`

## Verification

- invalid payloads produce readable validation errors
- retries back off and eventually stop
- idempotency key remains stable across retries
- tests pass

## Next Phase

-> **[Phase_4_Serverless_Functions.md](./Phase_4_Serverless_Functions.md)**
