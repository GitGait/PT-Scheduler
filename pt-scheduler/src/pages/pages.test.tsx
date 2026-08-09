import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
// Read as text (not imported as a module) so the guard below can assert on the
// source without pulling SchedulePage's heavy dependency graph into this suite.
import schedulePageSource from "./SchedulePage.tsx?raw";

// Mock all stores completely. Hoist stable state objects so function identities
// don't churn across re-renders — otherwise effects that depend on store actions
// loop forever and exhaust the heap.
const { patientStoreState, syncStoreState, appointmentStoreState, themeStoreState } = vi.hoisted(() => ({
    patientStoreState: {
        patients: [],
        loadAll: vi.fn().mockResolvedValue(undefined),
        loading: false,
        search: vi.fn(),
        getById: vi.fn(),
        add: vi.fn().mockResolvedValue(undefined),
        discharge: vi.fn().mockResolvedValue(undefined),
        reactivate: vi.fn().mockResolvedValue(undefined),
        clearError: vi.fn(),
        searchQuery: "",
        error: null,
    },
    syncStoreState: {
        isOnline: true,
        pendingCount: 0,
        refreshPendingCount: vi.fn().mockResolvedValue(undefined),
    },
    appointmentStoreState: {
        appointments: [],
        loadByRange: vi.fn().mockResolvedValue(undefined),
        markComplete: vi.fn().mockResolvedValue(undefined),
        loading: false,
    },
    themeStoreState: {
        mode: "system" as const,
        setMode: vi.fn(),
    },
}));

vi.mock("../stores", () => ({
    usePatientStore: () => patientStoreState,
    useSyncStore: () => syncStoreState,
    useAppointmentStore: () => appointmentStoreState,
    useThemeStore: () => themeStoreState,
}));

// Mock OCR API
vi.mock("../api/ocr", () => ({
    processScreenshotFile: vi.fn().mockResolvedValue({ appointments: [] }),
}));

// Import pages after mocking
import { ScanPage } from "./ScanPage";
import { SettingsPage } from "./SettingsPage";
import { UndoSurface } from "../components/ui/UndoDeleteToast";
import { useUndoStore, recordUndo } from "../stores/undoStore";

describe("Page Smoke Tests", () => {
    const renderWithRouter = (component: React.ReactElement) => {
        return render(<BrowserRouter>{component}</BrowserRouter>);
    };

    it("ScanPage renders without crashing", () => {
        renderWithRouter(<ScanPage />);
        expect(screen.getByText(/Scan Schedule/i)).toBeDefined();
    });

    it("SettingsPage renders without crashing", () => {
        renderWithRouter(<SettingsPage />);
        expect(screen.getByRole("heading", { name: /^Settings$/i })).toBeDefined();
    });
});

describe("undo surface re-render isolation", () => {
    // SchedulePage subscribes to the appointment store with no selector, so any
    // undo-store subscription placed there would re-render the whole ~2500-line
    // page on every push and every toast timer tick. These two tests are the
    // only automated defense against someone "simplifying" UndoSurface back
    // into a props-driven component.

    it("SchedulePage never subscribes to the undo stack itself", () => {
        expect(schedulePageSource).not.toMatch(/useUndoStack/);
        expect(schedulePageSource).not.toMatch(/useUndoStore/);
        // It may only reach undo through non-subscribing module functions.
        expect(schedulePageSource).toMatch(/<UndoSurface \/>/);
    });

    it("pushing an undo entry does not re-render siblings of UndoSurface", () => {
        let siblingRenders = 0;
        function Sibling() {
            siblingRenders += 1;
            return <div>sibling</div>;
        }

        render(
            <>
                <Sibling />
                <UndoSurface />
            </>
        );

        const before = siblingRenders;

        act(() => {
            recordUndo({
                kind: "update",
                reason: "move",
                appointmentId: "a",
                before: { startTime: "09:00" },
                after: { startTime: "10:00" },
            });
        });

        // The toast itself appeared…
        expect(screen.getByText("Appointment moved")).toBeDefined();
        // …but the push cost the rest of the tree nothing.
        expect(siblingRenders).toBe(before);

        useUndoStore.getState().clearHistory();
    });
});
