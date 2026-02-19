import { useEffect, useMemo, useState } from "react";
import { usePatientStore, useSyncStore, useThemeStore, type ThemeMode } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { initAuth, isSignedIn, signIn, signOut, getAccessToken, AUTH_STATE_CHANGED_EVENT } from "../api/auth";
import { fetchPatientsFromSheet } from "../api/sheets";
import { createCalendarEvent, listCalendars } from "../api/calendar";
import { geocodeAddress } from "../api/geocode";
import { reconcilePatientsFromSheetSnapshot } from "../db/patientSheetSync";
import { db } from "../db/schema";
import { env } from "../utils/env";
import { getHomeBase, setHomeBase } from "../utils/scheduling";

// Re-export for any consumers that import from here
export { AUTH_STATE_CHANGED_EVENT } from "../api/auth";

// Theme toggle component
function ThemeToggle() {
    const { mode, setMode } = useThemeStore();

    const options: { value: ThemeMode; label: string; icon: string }[] = [
        { value: "system", label: "System", icon: "💻" },
        { value: "light", label: "Light", icon: "☀️" },
        { value: "dark", label: "Dark", icon: "🌙" },
    ];

    return (
        <Card className="mb-4">
            <CardHeader title="Appearance" subtitle="Choose your preferred theme" />
            <div className="flex gap-2">
                {options.map((option) => (
                    <button
                        key={option.value}
                        onClick={() => setMode(option.value)}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                            mode === option.value
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
                        }`}
                    >
                        <span className="text-lg">{option.icon}</span>
                        <span className="text-sm font-medium">{option.label}</span>
                    </button>
                ))}
            </div>
        </Card>
    );
}

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
    const [syncingCalendar, setSyncingCalendar] = useState(false);
    const [testingCalendar, setTestingCalendar] = useState(false);
    const [availableCalendars, setAvailableCalendars] = useState<Array<{ id: string; summary: string }> | null>(null);

    // Home base configuration
    const [homeAddressInput, setHomeAddressInput] = useState(() => getHomeBase().address);
    const [homeBaseStatus, setHomeBaseStatus] = useState<string | null>(null);
    const [homeBaseError, setHomeBaseError] = useState<string | null>(null);
    const [savingHomeBase, setSavingHomeBase] = useState(false);

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

        // initAuth is idempotent — the app-level useGoogleAuth hook handles retry logic.
        // This just ensures local state is up-to-date when SettingsPage mounts.
        let cancelled = false;

        void initAuth(env.googleClientId).then(() => {
            if (!cancelled) {
                setAuthReady(true);
                setSignedIn(isSignedIn());
                setStatusError(null);
            }
        }).catch(() => {
            // Already initialized by useGoogleAuth; just sync local state
            if (!cancelled) {
                setAuthReady(isSignedIn());
                setSignedIn(isSignedIn());
            }
        });

        return () => {
            cancelled = true;
        };
    }, [hasClientId]);

    // Listen for auth state changes from TopNav sign-in
    useEffect(() => {
        const handleAuthChange = () => {
            setSignedIn(isSignedIn());
        };
        window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChange);
        return () => {
            window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChange);
        };
    }, []);

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
            setAuthReady(true);
            setSignedIn(isSignedIn());
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
            // Notify other components (like TopNav) of auth state change
            window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
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
        // Notify other components of auth state change
        window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
    };

    const handleSaveHomeBase = async () => {
        const address = homeAddressInput.trim();
        if (!address) {
            setHomeBaseError("Please enter your home address.");
            setHomeBaseStatus(null);
            return;
        }

        setSavingHomeBase(true);
        setHomeBaseError(null);
        setHomeBaseStatus(null);

        try {
            // Geocode the address to get coordinates
            const result = await geocodeAddress(address);

            if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
                setHomeBaseError("Could not find coordinates for this address.");
                return;
            }

            // Save to localStorage
            setHomeBase({
                address: result.formattedAddress || address,
                lat: result.lat,
                lng: result.lng,
            });

            setHomeAddressInput(result.formattedAddress || address);
            setHomeBaseStatus(`Home base saved. Coordinates: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
        } catch (err) {
            setHomeBaseError(err instanceof Error ? err.message : "Failed to geocode address.");
        } finally {
            setSavingHomeBase(false);
        }
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
            const syncResult = await reconcilePatientsFromSheetSnapshot(
                nextSpreadsheetId,
                patients
            );

            await loadAll();

            if (syncResult.upserted === 0 && syncResult.deleted === 0) {
                setStatusMessage("No patient rows were found in the sheet.");
            } else {
                const parts = [
                    `Imported/updated ${syncResult.upserted} patient${
                        syncResult.upserted === 1 ? "" : "s"
                    }.`,
                ];
                if (syncResult.deleted > 0) {
                    parts.push(
                        `Removed ${syncResult.deleted} patient${
                            syncResult.deleted === 1 ? "" : "s"
                        } deleted in Google Sheets.`
                    );
                }
                setStatusMessage(parts.join(" "));
            }
        } catch (err) {
            setStatusError(err instanceof Error ? err.message : "Patient import failed.");
        } finally {
            setImporting(false);
        }
    };

    const handleTestCalendarAccess = async () => {
        if (!signedIn) {
            setStatusError("Sign in to Google first.");
            return;
        }

        setTestingCalendar(true);
        setStatusError(null);
        setStatusMessage(null);
        setAvailableCalendars(null);

        try {
            const calendars = await listCalendars();
            setAvailableCalendars(calendars);
            if (calendars.length === 0) {
                setStatusMessage("No calendars found. This is unusual.");
            } else {
                setStatusMessage(`Found ${calendars.length} calendar(s). See list below.`);
            }
        } catch (err) {
            setStatusError(err instanceof Error ? err.message : "Failed to list calendars.");
        } finally {
            setTestingCalendar(false);
        }
    };

    const handleSyncAppointmentsToCalendar = async () => {
        const nextCalendarId = calendarInput.trim() || calendarId;

        if (!signedIn) {
            setStatusError("Sign in to Google before syncing appointments.");
            setStatusMessage(null);
            return;
        }

        if (!nextCalendarId) {
            setStatusError("Calendar ID is required. Enter 'primary' or your calendar ID.");
            setStatusMessage(null);
            return;
        }

        const token = await getAccessToken();
        if (!token) {
            setStatusError("Not authenticated. Please sign in again.");
            setStatusMessage(null);
            return;
        }

        setSyncingCalendar(true);
        setStatusError(null);
        setStatusMessage(null);

        try {
            // Get all appointments from local database
            const appointments = await db.appointments.toArray();
            const patients = await db.patients.toArray();
            const patientMap = new Map(patients.map(p => [p.id, p]));

            let created = 0;
            let skipped = 0;
            const errors: string[] = [];

            for (const appointment of appointments) {
                // Check if already has a calendar event
                const existingMapping = await db.calendarEvents
                    .where("appointmentId")
                    .equals(appointment.id)
                    .first();

                if (appointment.calendarEventId || existingMapping?.googleEventId) {
                    skipped++;
                    continue;
                }

                const patient = patientMap.get(appointment.patientId);
                const patientName = patient?.fullName ?? "Unknown";
                const address = patient?.address;
                const patientPhone = patient?.phone;

                try {
                    const eventId = await createCalendarEvent(
                        nextCalendarId,
                        appointment,
                        patientName,
                        address,
                        patientPhone
                    );

                    // Update local appointment with calendar event ID
                    await db.appointments.update(appointment.id, {
                        calendarEventId: eventId,
                        syncStatus: "synced",
                        updatedAt: new Date(),
                    });

                    // Store mapping
                    await db.calendarEvents.put({
                        id: eventId,
                        appointmentId: appointment.id,
                        googleEventId: eventId,
                        calendarId: nextCalendarId,
                        lastSyncedAt: new Date(),
                    });

                    created++;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : "Unknown error";
                    errors.push(`${patientName}: ${msg}`);
                }
            }

            if (errors.length > 0) {
                setStatusError(`Errors: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ""}`);
            }

            if (created > 0 || skipped > 0) {
                setStatusMessage(
                    `Synced ${created} appointment${created !== 1 ? "s" : ""} to Google Calendar. ${skipped} already synced.`
                );
            } else if (appointments.length === 0) {
                setStatusMessage("No appointments to sync.");
            }
        } catch (err) {
            setStatusError(err instanceof Error ? err.message : "Calendar sync failed.");
        } finally {
            setSyncingCalendar(false);
        }
    };

    return (
        <div className="pb-20 p-4 max-w-2xl mx-auto">
            <h1 className="mb-4 text-xl font-medium text-[var(--color-text-primary)]">Settings</h1>

            <Card className="mb-4">
                <CardHeader title="Connection Status" />
                <div className="flex items-center gap-3">
                    <div
                        className={`h-3 w-3 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`}
                        aria-hidden="true"
                    />
                    <span className="text-[var(--color-text-primary)]">{isOnline ? "Online" : "Offline"}</span>
                </div>
            </Card>

            <ThemeToggle />

            <Card className="mb-4">
                <CardHeader title="Home Base Address" subtitle="Your starting location for route calculations" />
                <div className="space-y-3">
                    <div>
                        <label htmlFor="home-address" className="mb-1 block text-sm text-[var(--color-text-secondary)]">
                            Home Address
                        </label>
                        <input
                            id="home-address"
                            type="text"
                            value={homeAddressInput}
                            onChange={(e) => setHomeAddressInput(e.target.value)}
                            className="w-full input-google"
                            placeholder="123 Main St, City, State ZIP"
                        />
                    </div>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSaveHomeBase()}
                        disabled={savingHomeBase}
                    >
                        {savingHomeBase ? "Saving..." : "Save Home Base"}
                    </Button>
                    {homeBaseStatus && (
                        <p className="text-sm text-[var(--color-event-green)]">{homeBaseStatus}</p>
                    )}
                    {homeBaseError && (
                        <p className="text-sm text-[var(--color-event-red)]">{homeBaseError}</p>
                    )}
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
                        <label htmlFor="spreadsheet-id" className="mb-1 block text-sm text-[var(--color-text-secondary)]">
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
                        <label htmlFor="calendar-id" className="mb-1 block text-sm text-[var(--color-text-secondary)]">
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
                <p className="text-sm text-[var(--color-text-primary)]">
                    Tab name: <span className="font-semibold">Patients</span>
                </p>
                <p className="mt-2 break-all rounded bg-[var(--color-surface-hover)] p-2 font-mono text-xs text-[var(--color-text-primary)]">
                    id,fullName,nicknames,phone,alternateContacts,address,lat,lng,status,notes
                </p>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    alternateContacts format: Name|Phone|Relationship; Name|Phone
                </p>
                <div className="mt-3 flex flex-col gap-1">
                    <a
                        href="/templates/patients_template.csv"
                        download
                        className="inline-block text-sm text-[var(--color-primary)] hover:underline"
                    >
                        Download CSV template
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
                <CardHeader title="Calendar Sync" subtitle="Push all local appointments to Google Calendar" />
                <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                    This will create calendar events for all appointments that haven't been synced yet.
                    Other devices can then pull these from Google Calendar.
                </p>
                <div className="flex gap-2 flex-wrap">
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleTestCalendarAccess()}
                        disabled={testingCalendar || !signedIn}
                    >
                        {testingCalendar ? "Testing..." : "Test Calendar Access"}
                    </Button>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSyncAppointmentsToCalendar()}
                        disabled={syncingCalendar || !signedIn}
                    >
                        {syncingCalendar ? "Syncing..." : "Sync Appointments to Calendar"}
                    </Button>
                </div>
                {availableCalendars && availableCalendars.length > 0 && (
                    <div className="mt-3 p-3 bg-[var(--color-surface-hover)] rounded text-sm">
                        <p className="font-medium mb-2">Your calendars:</p>
                        <ul className="space-y-1">
                            {availableCalendars.map((cal) => (
                                <li key={cal.id} className="flex justify-between">
                                    <span>{cal.summary}</span>
                                    <code className="text-xs bg-[var(--color-surface)] px-1 rounded">{cal.id}</code>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-[var(--color-text-secondary)]">
                            Use one of these IDs in the Calendar ID field above.
                        </p>
                    </div>
                )}
            </Card>

            <Card className="mb-4">
                <CardHeader title="Sync Queue" subtitle={`${pendingCount} pending items`} />
                {pendingCount > 0 ? (
                    <div className="mt-3 space-y-2">
                        <p className="text-sm text-[var(--color-text-secondary)]">Changes will sync when online</p>
                        <Button size="sm" variant="secondary" onClick={() => void refreshPendingCount()}>
                            Refresh
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-green-700 dark:text-green-300">All changes synced</p>
                )}
            </Card>

            {(statusMessage || statusError) && (
                <Card className="mb-4">
                    <CardHeader title="Status" />
                    {statusMessage && <p className="text-sm text-green-700 dark:text-green-300">{statusMessage}</p>}
                    {statusError && <p className="text-sm text-red-600 dark:text-red-400">{statusError}</p>}
                </Card>
            )}

            <Card>
                <CardHeader title="About" />
                <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                    <p>PT Scheduler v1.0.0</p>
                    <p>Home Health Physical Therapy</p>
                </div>
            </Card>
        </div>
    );
}
