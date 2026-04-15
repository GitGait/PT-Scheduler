import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

// Test component that throws an error
function ThrowError(): ReactNode {
    throw new Error("Test error");
}

// Test component that renders normally
function NormalComponent() {
    return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
    // Suppress console.error for these tests
    const originalError = console.error;
    beforeEach(() => {
        console.error = vi.fn();
    });
    afterEach(() => {
        console.error = originalError;
    });

    it("renders children when no error", () => {
        render(
            <ErrorBoundary>
                <NormalComponent />
            </ErrorBoundary>
        );
        expect(screen.getByText("Normal content")).toBeDefined();
    });

    it("renders error UI when child throws", () => {
        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );
        expect(screen.getByText(/Something went wrong/i)).toBeDefined();
    });

    it("displays reload button in error state", () => {
        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );
        expect(screen.getAllByRole("button", { name: /reload/i }).length).toBeGreaterThan(0);
    });
});
