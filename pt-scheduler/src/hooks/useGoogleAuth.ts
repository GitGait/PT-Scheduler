import { useEffect } from "react";
import { initAuth, tryRestoreSignIn, AUTH_STATE_CHANGED_EVENT } from "../api/auth";
import { env } from "../utils/env";

/**
 * App-level hook that initializes Google Identity Services on startup.
 * Retries until the GIS script is loaded, then restores any existing session.
 * Call once in the App component so auth works on every page.
 */
export function useGoogleAuth(): void {
    useEffect(() => {
        const clientId = env.googleClientId;
        if (!clientId) return;

        let cancelled = false;
        const maxAttempts = 20;

        const init = async () => {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (cancelled) return;

                try {
                    await initAuth(clientId);
                    if (cancelled) return;

                    await tryRestoreSignIn();
                    if (!cancelled) {
                        window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
                    }
                    return;
                } catch (err) {
                    const message = err instanceof Error ? err.message : "";
                    const shouldRetry = message.includes("Google Identity Services not loaded");

                    if (!shouldRetry || attempt === maxAttempts) return;

                    await new Promise((r) => setTimeout(r, 300));
                }
            }
        };

        void init();

        return () => {
            cancelled = true;
        };
    }, []);
}
