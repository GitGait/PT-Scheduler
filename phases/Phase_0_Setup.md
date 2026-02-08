# Phase 0: Setup

> Goal: initialize the Vite React TypeScript app with PWA support and base folders.

## Prerequisites

- Node 18+
- npm

## Steps

### 0.1 Create app

```bash
npm create vite@latest pt-scheduler -- --template react-ts
cd pt-scheduler
```

### 0.2 Install dependencies

Pin exact versions to ensure reproducible builds:

```bash
npm install zustand@4.5.5 dexie@4.0.10 fuse.js@7.0.0 date-fns@3.6.0 uuid@9.0.1 zod@3.23.8
npm install browser-image-compression@2.0.2 react-router-dom@6.26.2 lucide-react@0.453.0
npm install -D tailwindcss@3.4.13 postcss@8.4.47 autoprefixer@10.4.20 vite-plugin-pwa@0.20.5
npm install -D @vercel/node@3.2.24 vitest@2.1.4 @vitest/coverage-v8@2.1.4 jsdom@25.0.1
npm install -D @testing-library/react@16.0.1 @testing-library/jest-dom@6.6.3
npx tailwindcss init -p
```

> **Note:** `react-easy-crop` and `pdfjs-dist` were removed — they are not referenced by any phase. If needed later, add them explicitly.

### 0.3 Create folders

```bash
mkdir -p src/components/{ui,calendar,patients,appointments,route,scan}
mkdir -p src/{pages,stores,db,api,utils,hooks,types}
mkdir -p api public/icons
```

### 0.4 Environment template

Create `.env.example`:

```env
VITE_GOOGLE_CLIENT_ID=
VITE_GOOGLE_SHEETS_ID=
VITE_GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_API_KEY=
OPENAI_API_KEY=
PRODUCTION_URL=
```

### 0.4b Client env validation

Create `src/utils/env.ts` to validate client-side env vars at startup:

```ts
interface EnvConfig {
  googleClientId: string;
  googleSheetsId: string;
  googleMapsApiKey: string;
}

function requireViteEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value || value === "") {
    console.warn(`Missing env var: ${name}. Some features will be unavailable.`);
    return "";
  }
  return value as string;
}

export const env: EnvConfig = {
  googleClientId: requireViteEnv("VITE_GOOGLE_CLIENT_ID"),
  googleSheetsId: requireViteEnv("VITE_GOOGLE_SHEETS_ID"),
  googleMapsApiKey: requireViteEnv("VITE_GOOGLE_MAPS_API_KEY"),
};
```

Import this in `main.tsx` so warnings appear early in the console during development.

### 0.5 PWA baseline

Add `vite-plugin-pwa` in `vite.config.ts` with this manifest configuration:

```ts
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PT Scheduler",
        short_name: "PTSched",
        description: "Home health PT scheduling with OCR and route optimization",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]
      }
    })
  ]
});
```

Create placeholder icon files in `public/icons/` (replace with real icons before deploy):
- `icon-192.png` (192x192)
- `icon-512.png` (512x512)
- `icon-512-maskable.png` (512x512 with safe zone padding)

## Verification

- `npm run dev` starts cleanly.
- Placeholder routes load.
- Env template exists.

## Next Phase

-> **[Phase_1_Types_and_Database.md](./Phase_1_Types_and_Database.md)**
