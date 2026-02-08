/**
 * Google Identity Services (GIS) authentication module.
 * Uses OAuth 2.0 implicit flow for client-side authentication.
 */

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const TOKEN_STORAGE_KEY = "ptScheduler.googleAuthToken";

// Access token stored in memory and mirrored in sessionStorage (short-lived)
let accessToken: string | null = null;
let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let tokenExpiresAt: number = 0;

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

type TokenPrompt = "" | "consent";

interface StoredToken {
    accessToken: string;
    tokenExpiresAt: number;
}

function persistToken(): void {
    if (typeof window === "undefined") return;

    if (!accessToken || tokenExpiresAt <= 0) {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        return;
    }

    const payload: StoredToken = { accessToken, tokenExpiresAt };
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(payload));
}

function restoreTokenFromStorage(): void {
    if (typeof window === "undefined") return;

    const raw = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
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

    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function setToken(token: string, expiresInSeconds: number): void {
    accessToken = token;
    tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    persistToken();
}

function clearToken(): void {
    accessToken = null;
    tokenExpiresAt = 0;
    persistToken();
}

restoreTokenFromStorage();

/**
 * Initialize the Google OAuth token client.
 * Must be called after GIS script loads.
 */
export function initAuth(clientId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
            reject(new Error("Google Identity Services not loaded"));
            return;
        }

        try {
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: (response: TokenResponse) => {
                    if (response.access_token && response.expires_in) {
                        setToken(response.access_token, response.expires_in);
                    }
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
    return requestAccessToken("consent");
}

/**
 * Attempt a silent sign-in using existing Google session.
 * Returns true if a valid token was restored.
 */
export async function tryRestoreSignIn(): Promise<boolean> {
    if (!tokenClient) return false;

    if (accessToken && Date.now() < tokenExpiresAt - 60000) {
        return true;
    }

    try {
        await requestAccessToken("");
        return true;
    } catch {
        return false;
    }
}

function requestAccessToken(prompt: TokenPrompt): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            reject(new Error("Auth not initialized"));
            return;
        }

        // Override callback for this request
        const originalCallback = tokenClient.callback;
        tokenClient.callback = (response: TokenResponse) => {
            if (response.access_token && response.expires_in) {
                setToken(response.access_token, response.expires_in);
                resolve(response.access_token);
            } else if (response.error) {
                reject(new Error(response.error_description || response.error));
            } else {
                reject(new Error("Sign-in failed"));
            }
            tokenClient!.callback = originalCallback;
        };

        tokenClient.requestAccessToken({ prompt });
    });
}

/**
 * Sign out and clear the access token.
 */
export function signOut(): void {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => { });
    }
    clearToken();
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

    // Try a silent refresh if auth is initialized and user has already granted consent.
    if (tokenClient) {
        try {
            return await requestAccessToken("");
        } catch {
            return null;
        }
    }

    return null;
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
 * Add type declarations for Google Identity Services.
 */
declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        callback: (response: TokenResponse) => void;
                    }) => google.accounts.oauth2.TokenClient;
                    revoke: (token: string, callback: () => void) => void;
                };
            };
        };
    }

    namespace google.accounts.oauth2 {
        interface TokenClient {
            callback: (response: TokenResponse) => void;
            requestAccessToken: (options?: { prompt?: string }) => void;
        }
    }
}
