import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

// Mock all stores completely
vi.mock("../stores", () => ({
    usePatientStore: () => ({
        patients: [],
        loadAll: vi.fn(),
        loading: false,
        search: vi.fn(),
        getById: vi.fn(),
        add: vi.fn(),
        discharge: vi.fn(),
        reactivate: vi.fn(),
        clearError: vi.fn(),
        searchQuery: "",
        error: null,
    }),
    useSyncStore: () => ({
        isOnline: true,
        pendingCount: 0,
        refreshPendingCount: vi.fn(),
    }),
    useAppointmentStore: () => ({
        appointments: [],
        loadByDate: vi.fn(),
        loading: false,
    }),
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
        expect(screen.getByText(/Today's Route/i)).toBeDefined();
    });

    it("SettingsPage renders without crashing", () => {
        renderWithRouter(<SettingsPage />);
        expect(screen.getByRole("heading", { name: /^Settings$/i })).toBeDefined();
    });
});
