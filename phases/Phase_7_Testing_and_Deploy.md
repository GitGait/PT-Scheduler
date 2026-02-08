# Phase 7: Testing and Deploy

> Goal: validate functionality and deploy safely to production.

## Prerequisites

- Phases 0-6 complete

## 7.1 Pre-deploy checklist

- env vars configured
- Google OAuth, Sheets, Calendar, Maps APIs enabled
- production URL added in OAuth settings

## 7.1b API key restrictions (required)

- `VITE_GOOGLE_MAPS_API_KEY` restricted by referrer
- `GOOGLE_MAPS_API_KEY` restricted server-side where possible
- API restrictions limited to required services
- `OPENAI_API_KEY` only in server env
- rotate keys after initial production launch

## 7.2 Automated tests

Run:

```bash
npm run test
npm run build
```

Minimum suites:
- validation schemas (`validation.test.ts`)
- matching behavior (`matching.test.ts`)
- queue backoff/idempotency (`syncQueue.test.ts`)
- ErrorBoundary component render (`ErrorBoundary.test.tsx` — uses `@testing-library/react`)
- at least one page smoke test (renders without crashing)

## 7.3 Manual checklist

- navigation and pages
- OCR flow
- route optimization
- offline queue and resync
- Sheets and Calendar sync
- iPhone PWA install/use

### Accessibility checks

- keyboard navigation on desktop
- visible focus indicators
- aria labels on icon-only controls
- VoiceOver basic pass on iPhone

## 7.4 Deploy

Use Vercel CLI or GitHub integration.

## 7.5 Monitoring

- Vercel function logs
- OpenAI usage/cost dashboard
- Google quota dashboards
- optional Sentry or structured error logs

## Success Criteria

- core workflows pass on desktop and iPhone
- no silent sync failures
- queue retries and conflict handling observable in UI
