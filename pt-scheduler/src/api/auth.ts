/**
 * Google Identity Services (GIS) authentication module.
 * Uses OAuth 2.0 authorization code flow with server-side refresh tokens
 * for persistent sessions that survive browser restarts and token expiry.
 */

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar",
].join(" ");

const TOKEN_STORAGE_KEY = "ptScheduler.googleAuthToken";

export const AUTH_STATE_CHANGED_EVENT = "pt-scheduler:auth-state-changed";

// Access token stored in memory and mirrored in localStorage (persists across tabs/restarts)
let accessToken: string | null = null;
let codeClient: google.accounts.oauth2.CodeClient | null = null;
let tokenExpiresAt: number = 0;
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

// Pending sign-in promise handlers (resolved by the GIS code callback)
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

interface CodeResponse {
    code: string;
    scope: string;
    error?: string;
    error_description?: string;
}

interface ServerTokenResponse {
    access_token: string;
    expires_in: number;
    persistent?: boolean;
    error?: string;
}

interface StoredToken {
    accessToken: string;
    tokenExpiresAt: number;
}

function persistToken(): void {
    if (typeof window === "undefined") return;

    if (!accessToken || tokenExpiresAt <= 0) {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        return;
    }

    const payload: StoredToken = { accessToken, tokenExpiresAt };
    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(payload));
}

function restoreTokenFromStorage(): void {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw) as Partial<StoredToken>;
        if (
            typeof parsed.accessToken === "string" &&
            typeof parsed.tokenExpiresAt === "number" &&
            parsed.tokenExpiresAt > Date.now()
        ) {
            accessToken = parsed.accessToken;
            tokenExpiresAt = parsed.tokenExpiresAt;
            return;
        }
    } catch {
        // ignore and clear invalid data below
    }

    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function setToken(token: string, expiresInSeconds: number): void {
    accessToken = token;
    tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    persistToken();
    scheduleTokenRefresh(expiresInSeconds);
}

function clearToken(): void {
    if (refreshTimerId !== null) {
        clearTimeout(refreshTimerId);
        refreshTimerId = null;
    }
    accessToken = null;
    tokenExpiresAt = 0;
    persistToken();
}

function scheduleTokenRefresh(expiresInSeconds: number): void {
    if (refreshTimerId !== null) {
        clearTimeout(refreshTimerId);
        refreshTimerId = null;
    }

    // Refresh 5 minutes before expiry
    const delayMs = (expiresInSeconds - 300) * 1000;
    if (delayMs <= 0) return;

    console.log(`[Auth] Scheduling token refresh in ${Math.round(delayMs / 1000)}s`);
    refreshTimerId = setTimeout(async () => {
        refreshTimerId = null;
        try {
            await refreshViaServer();
            // Success — setToken schedules the next refresh
        } catch {
            console.warn("[Auth] Silent token refresh failed");
            clearToken();
            window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
        }
    }, delayMs);
}

/**
 * Exchange refresh token cookie for a new access token via the server.
 */
async function refreshViaServer(): Promise<string> {
    const resp = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
    });

    if (!resp.ok) {
        throw new Error("Refresh failed");
    }

    const data: ServerTokenResponse = await resp.json();
    if (!data.access_token || !data.expires_in) {
        throw new Error("Invalid refresh response");
    }

    setToken(data.access_token, data.expires_in);
    return data.access_token;
}

// Restore token from localStorage on module load
restoreTokenFromStorage();

// If a valid token was restored, schedule its refresh
if (accessToken && tokenExpiresAt > Date.now()) {
    const remainingSeconds = Math.floor((tokenExpiresAt - Date.now()) / 1000);
    scheduleTokenRefresh(remainingSeconds);
}

/**
 * Initialize the Google OAuth code client.
 * Must be called after GIS script loads.
 */
export function initAuth(clientId: string): Promise<void> {
    if (codeClient) return Promise.resolve(); // Already initialized

    return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
            reject(new Error("Google Identity Services not loaded"));
            return;
        }

        try {
            codeClient = window.google.accounts.oauth2.initCodeClient({
                client_id: clientId,
                scope: SCOPES,
                ux_mode: "popup",
                callback: async (response: CodeResponse) => {
                    console.log("[Auth] Code callback fired", response.error || "OK");
                    if (response.error) {
                        console.error("[Auth] Code response error:", response.error, response.error_description);
                        pendingReject?.(
                            new Error(response.error_description || response.error)
                        );
                        pendingResolve = null;
                        pendingReject = null;
                        return;
                    }

                    try {
                        console.log("[Auth] Exchanging code with server...");
                        const resp = await fetch("/api/auth/exchange", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ code: response.code }),
                        });
                        console.log("[Auth] Exchange response:", resp.status, resp.statusText);

                        if (!resp.ok) {
                            const err = await resp
                                .json()
                                .catch(() => ({ error: "Token exchange failed" }));
                            console.error("[Auth] Exchange failed:", err);
                            throw new Error(
                                (err as { error?: string }).error || "Token exchange failed"
                            );
                        }

                        const data: ServerTokenResponse = await resp.json();
                        console.log("[Auth] Exchange succeeded, persistent:", data.persistent);
                        setToken(data.access_token, data.expires_in);
                        if (data.persistent === false) {
                            console.warn("[Auth] No refresh token received — sign-in won't persist. Revoke app at myaccount.google.com/permissions and re-sign-in.");
                        }
                        window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
                        pendingResolve?.(data.access_token);
                    } catch (err) {
                        console.error("[Auth] Sign-in error:", err);
                        pendingReject?.(
                            err instanceof Error ? err : new Error("Token exchange failed")
                        );
                    }

                    pendingResolve = null;
                    pendingReject = null;
                },
                error_callback: (error: { type: string }) => {
                    pendingReject?.(new Error(error.type || "Sign-in cancelled"));
                    pendingResolve = null;
                    pendingReject = null;
                },
            });
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Request an access token from the user.
 * Opens Google sign-in popup.
 */
export function signIn(): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!codeClient) {
            reject(new Error("Auth not initialized"));
            return;
        }

        pendingResolve = resolve;
        pendingReject = reject;
        codeClient.requestCode();
    });
}

/**
 * Attempt to restore sign-in using the server-side refresh token.
 * Returns true if a valid token was restored.
 */
export async function tryRestoreSignIn(): Promise<boolean> {
    // Valid token already in memory (from localStorage)
    if (accessToken && Date.now() < tokenExpiresAt - 60000) {
        return true;
    }

    // Try server-side refresh (httpOnly cookie)
    try {
        await refreshViaServer();
        return true;
    } catch {
        return false;
    }
}

/**
 * Sign out and clear the access token + server refresh token.
 */
export function signOut(): void {
    clearToken();

    // Clear the server-side refresh token cookie
    fetch("/api/auth/refresh", {
        method: "DELETE",
        credentials: "include",
    }).catch(() => {
        // Best effort — cookie will eventually expire
    });
}

/**
 * Get the current access token, refreshing if needed.
 */
export async function getAccessToken(): Promise<string | null> {
    // If token is still valid, return it
    if (accessToken && Date.now() < tokenExpiresAt - 60000) {
        return accessToken;
    }

    if (accessToken && Date.now() >= tokenExpiresAt) {
        clearToken();
    }

    // Try a server-side refresh using the httpOnly cookie
    try {
        return await refreshViaServer();
    } catch {
        return null;
    }
}

/**
 * Check if the user is signed in.
 */
export function isSignedIn(): boolean {
    if (accessToken && Date.now() >= tokenExpiresAt) {
        clearToken();
        return false;
    }
    return !!accessToken && Date.now() < tokenExpiresAt;
}

/**
 * Add type declarations for Google Identity Services (Code Client).
 */
declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initCodeClient: (config: {
                        client_id: string;
                        scope: string;
                        ux_mode: string;
                        callback: (response: CodeResponse) => void;
                        error_callback?: (error: { type: string }) => void;
                    }) => google.accounts.oauth2.CodeClient;
                    revoke: (token: string, callback: () => void) => void;
                };
            };
        };
    }

    namespace google.accounts.oauth2 {
        interface CodeClient {
            requestCode: () => void;
        }
    }
}
