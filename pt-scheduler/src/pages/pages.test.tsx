import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

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
import { RoutePage } from "./RoutePage";
import { SettingsPage } from "./SettingsPage";

describe("Page Smoke Tests", () => {
    const renderWithRouter = (component: React.ReactElement) => {
        return render(<BrowserRouter>{component}</BrowserRouter>);
    };

    it("ScanPage renders without crashing", () => {
        renderWithRouter(<ScanPage />);
        expect(screen.getByText(/Scan Schedule/i)).toBeDefined();
    });

    it("RoutePage renders without crashing", () => {
        renderWithRouter(<RoutePage />);
        expect(screen.getByLabelText(/Previous day/i)).toBeDefined();
    });

    it("SettingsPage renders without crashing", () => {
        renderWithRouter(<SettingsPage />);
        expect(screen.getByRole("heading", { name: /^Settings$/i })).toBeDefined();
    });
});
