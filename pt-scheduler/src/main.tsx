import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { geocodeCacheDB } from './db/operations'

// Opportunistic geocode-cache cleanup on app start.
// Per Google Maps Platform ToS §3.2.3(b), Geocoding Content may only be cached
// for up to 30 days. Entries older than that are evicted lazily on read, but
// this startup sweep also deletes stale rows that might never be read again
// (e.g., a patient whose address changed).
void geocodeCacheDB.purgeExpired().catch((err) => {
    console.warn(
        '[Geocode] Startup cache purge failed:',
        err instanceof Error ? err.message : err,
    )
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
