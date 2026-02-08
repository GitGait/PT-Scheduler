import { useEffect, useMemo, useState } from "react";
import { usePatientStore, useSyncStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { initAuth, isSignedIn, signIn, signOut, tryRestoreSignIn } from "../api/auth";
import { fetchPatientsFromSheet } from "../api/sheets";
import { patientDB } from "../db/operations";
import { env } from "../utils/env";

function normalizeSpreadsheetId(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] ?? trimmed;
}

export function SettingsPage() {
    const {
        isOnline,
        pendingCount,
        refreshPendingCount,
        spreadsheetId,
        calendarId,
        setSyncConfig,
        clearSyncConfig,
    } = useSyncStore();

    const { loadAll } = usePatientStore();

    const [sheetInput, setSheetInput] = useState(spreadsheetId);
    const [calendarInput, setCalendarInput] = useState(calendarId);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);

    const [authReady, setAuthReady] = useState(false);
    const [authBusy, setAuthBusy] = useState(false);
    const [signedIn, setSignedIn] = useState(isSignedIn());

    const [importing, setImporting] = useState(false);

    const hasClientId = useMemo(() => Boolean(env.googleClientId), []);

    useEffect(() => {
        void refreshPendingCount();
    }, [refreshPendingCount]);

    useEffect(() => {
        setSheetInput(spreadsheetId);
    }, [spreadsheetId]);

    useEffect(() => {
        setCalendarInput(calendarId);
    }, [calendarId]);

    useEffect(() => {
        if (!hasClientId) {
            setAuthReady(false);
            setStatusError("Missing VITE_GOOGLE_CLIENT_ID. Add it in your Vercel environment variables.");
            return;
        }

        let cancelled = false;
        const maxAttempts = 20;

        const initWithRetry = async () => {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    await initAuth(env.googleClientId);
                    const restored = await tryRestoreSignIn();
                    if (!cancelled) {
                        setAuthReady(true);
                        setSignedIn(restored || isSignedIn());
                        setStatusError(null);
                    }
                    return;
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : "Google auth initialization failed";
                    const shouldRetry = message.includes("Google Identity Services not loaded");

                    if (!shouldRetry || attempt === maxAttempts) {
                        if (!cancelled) {
                            setAuthReady(false);
                            setStatusError(message);
                        }
                        return;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }
        };

        void initWithRetry();

        return () => {
            cancelled = true;
        };
    }, [hasClientId]);

    const ensureAuthReady = async (): Promise<boolean> => {
        if (!hasClientId) {
            setAuthReady(false);
            setStatusError("Missing VITE_GOOGLE_CLIENT_ID. Add it in your Vercel environment variables.");
            return false;
        }

        if (authReady) {
            return true;
        }

        try {
            await initAuth(env.googleClientId);
            const restored = await tryRestoreSignIn();
            setAuthReady(true);
            setSignedIn(restored || isSignedIn());
            setStatusError(null);
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Google auth initialization failed";
            setAuthReady(false);
            setStatusError(message);
            return false;
        }
    };

    const handleSaveConfig = () => {
        const nextSpreadsheetId = normalizeSpreadsheetId(sheetInput);
        const nextCalendarId = calendarInput.trim();

        if (!nextSpreadsheetId && !nextCalendarId) {
            setStatusError("Enter a Spreadsheet ID, Calendar ID, or both.");
            setStatusMessage(null);
            return;
        }

        setSyncConfig({
            spreadsheetId: nextSpreadsheetId,
            calendarId: nextCalendarId,
        });

        setSheetInput(nextSpreadsheetId);
        setStatusError(null);
        setStatusMessage("Sync settings saved.");
    };

    const handleClearConfig = () => {
        clearSyncConfig();
        setStatusError(null);
        setStatusMessage("Sync settings cleared.");
    };

    const handleSignIn = async () => {
        const ready = await ensureAuthReady();
        if (!ready) {
            return;
        }

        setAuthBusy(true);
        setStatusMessage(null);
        setStatusError(null);

        try {
            await signIn();
            setSignedIn(true);
            setStatusMessage("Connected to Google.");
        } catch (err) {
            setStatusError(err instanceof Error ? err.message : "Google sign-in failed.");
        } finally {
            setAuthBusy(false);
        }
    };

    const handleSignOut = () => {
        signOut();
        setSignedIn(false);
        setStatusError(null);
        setStatusMessage("Signed out of Google.");
    };

    const handleImportPatients = async () => {
        const nextSpreadsheetId = normalizeSpreadsheetId(sheetInput || spreadsheetId);

        if (!signedIn) {
            setStatusError("Sign in to Google before importing patients.");
            setStatusMessage(null);
            return;
        }

        if (!nextSpreadsheetId) {
            setStatusError("Spreadsheet ID is required.");
            setStatusMessage(null);
            return;
        }

        setImporting(true);
        setStatusError(null);
        setStatusMessage(null);

        try {
            const patients = await fetchPatientsFromSheet(nextSpreadsheetId);
            for (const patient of patients) {
                await patientDB.upsert(patient);
            }

            await loadAll();
            setStatusMessage(
                patients.length === 0
                    ? "No patient rows were found in the sheet."
                    : `Imported ${patients.length} patient${patients.length === 1 ? "" : "s"}.`
            );
        } catch (err) {
            setStatusError(err instanceof Error ? err.message : "Patient import failed.");
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="pb-20 p-4 max-w-2xl mx-auto">
            <h1 className="mb-4 text-xl font-medium text-[#202124]">Settings</h1>

            <Card className="mb-4">
                <CardHeader title="Connection Status" />
                <div className="flex items-center gap-3">
                    <div
                        className={`h-3 w-3 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`}
                        aria-hidden="true"
                    />
                    <span className="text-[#3c4043]">{isOnline ? "Online" : "Offline"}</span>
                </div>
            </Card>

            <Card className="mb-4">
                <CardHeader title="Google Account" subtitle={signedIn ? "Connected" : "Not connected"} />
                <div className="mt-2 flex gap-2">
                    {signedIn ? (
                        <Button size="sm" variant="secondary" onClick={handleSignOut}>
                            Sign Out
                        </Button>
                    ) : (
                        <Button size="sm" variant="primary" onClick={handleSignIn} disabled={authBusy || !hasClientId}>
                            {authBusy ? "Signing In..." : authReady ? "Sign In with Google" : "Initialize & Sign In"}
                        </Button>
                    )}
                </div>
            </Card>

            <Card className="mb-4">
                <CardHeader title="Google Sync Setup" subtitle="Paste Spreadsheet ID or full sheet URL" />
                <div className="space-y-3">
                    <div>
                        <label htmlFor="spreadsheet-id" className="mb-1 block text-sm text-[#5f6368]">
                            Spreadsheet ID (optional, required for patient import)
                        </label>
                        <input
                            id="spreadsheet-id"
                            type="text"
                            value={sheetInput}
                            onChange={(e) => setSheetInput(e.target.value)}
                            className="w-full input-google"
                            placeholder="1AbC..."
                        />
                    </div>
                    <div>
                        <label htmlFor="calendar-id" className="mb-1 block text-sm text-[#5f6368]">
                            Google Calendar ID (optional, for appointment sync)
                        </label>
                        <input
                            id="calendar-id"
                            type="text"
                            value={calendarInput}
                            onChange={(e) => setCalendarInput(e.target.value)}
                            className="w-full input-google"
                            placeholder="primary or your_calendar_id@group.calendar.google.com"
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={handleSaveConfig}>
                            Save Settings
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleClearConfig}>
                            Clear
                        </Button>
                    </div>
                </div>
            </Card>

            <Card className="mb-4">
                <CardHeader title="Patient Sheet Template" />
                <p className="text-sm text-[#3c4043]">
                    Tab name: <span className="font-semibold">Patients</span>
                </p>
                <p className="mt-2 break-all rounded bg-[#f1f3f4] p-2 font-mono text-xs text-[#3c4043]">
                    id,fullName,nicknames,phone,alternateContacts,address,lat,lng,status,notes
                </p>
                <p className="mt-2 text-xs text-[#5f6368]">
                    alternateContacts format: Name|Phone|Relationship; Name|Phone
                </p>
                <div className="mt-3 flex flex-col gap-1">
                    <a
                        href="/templates/patients_template.csv"
                        download
                        className="inline-block text-sm text-[#1a73e8] hover:underline"
                    >
                        Download CSV template
                    </a>
                    <a
                        href="/templates/patients_sample_15.csv"
                        download
                        className="inline-block text-sm text-[#1a73e8] hover:underline"
                    >
                        Download sample CSV (15 patients)
                    </a>
                </div>
            </Card>

            <Card className="mb-4">
                <CardHeader title="Patient Import" subtitle="Pull data from Google Sheets into local app" />
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleImportPatients()}
                    disabled={importing || !signedIn}
                >
                    {importing ? "Importing..." : "Import Patients Now"}
                </Button>
            </Card>

            <Card className="mb-4">
                <CardHeader title="Sync Queue" subtitle={`${pendingCount} pending items`} />
                {pendingCount > 0 ? (
                    <div className="mt-3 space-y-2">
                        <p className="text-sm text-[#5f6368]">Changes will sync when online</p>
                        <Button size="sm" variant="secondary" onClick={() => void refreshPendingCount()}>
                            Refresh
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-[#1e8e3e]">All changes synced</p>
                )}
            </Card>

            {(statusMessage || statusError) && (
                <Card className="mb-4">
                    <CardHeader title="Status" />
                    {statusMessage && <p className="text-sm text-[#1e8e3e]">{statusMessage}</p>}
                    {statusError && <p className="text-sm text-[#d93025]">{statusError}</p>}
                </Card>
            )}

            <Card>
                <CardHeader title="About" />
                <div className="space-y-2 text-sm text-[#5f6368]">
                    <p>PT Scheduler v1.0.0</p>
                    <p>Home Health Physical Therapy</p>
                </div>
            </Card>
        </div>
    );
}
