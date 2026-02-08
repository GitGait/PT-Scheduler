# PT Scheduler

Home health PT scheduling PWA with OCR, patient matching, and route optimization.

> **🤖 AI Developers: Read `../HANDOFF.md` first before making changes!**

## Quick Start

```bash
npm install
npm run dev     # Start dev server at http://localhost:5173
npm test        # Run tests
npm run build   # Production build
```

## Google Sheets Setup

- See `GOOGLE_SHEETS_SETUP.md` for the required patient sheet format and connection steps.

## Project Structure

```
src/
├── api/          # Client-side API helpers
├── components/   # React components
├── db/           # Dexie database (schema, operations)
├── hooks/        # React hooks
├── pages/        # Page components
├── stores/       # Zustand state stores
├── types/        # TypeScript types
└── utils/        # Utilities
```

## Tech Stack

- **React 19** + TypeScript
- **Vite** + PWA support
- **Dexie** (IndexedDB)
- **Zustand** (state management)
- **Tailwind CSS**
- **Vitest** (testing)

## Phase Documentation

See `../phases/` for detailed implementation specs.
