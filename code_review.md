# In-Depth Code Review: Scheduler App

## Executive Summary
This review expands upon the initial design review with a deep dive into the codebase's mechanics. While the visual layer is polished, the underlying architecture exhibits significant technical debt in the form of monolithic components, insecure data handling, and race-condition-prone state management.

## 1. Architecture & Patterns

### 🔴 Critical Issues
*   **Monolithic Page Components:** `SchedulePage.tsx` (>3000 lines) and `PatientsPage.tsx` (>2000 lines) are unmaintainable. They violate the Single Responsibility Principle by mixing:
    *   UI Rendering
    *   Complex Business Logic (Geocoding, Distance Calculation, CSV Parsing)
    *   Data Fetching & Synchronization
    *   State Management
*   **Event Bus Anti-Pattern:** The use of `window.dispatchEvent(new Event(REQUEST_SYNC_EVENT))` for critical data synchronization triggers (`request.ts`, `SchedulePage.tsx`) is fragile. It decouples the trigger from the action in a way that makes data flow untraceable and prone to race conditions.
*   **Direct Store Access in Components:** Components frequently bypass a service layer to access `appointmentStore` and `patientStore` directly. This makes refactoring the storage engine (e.g., from Dexie to a backend API) nearly impossible without rewriting all UI components.

### 🟡 Warnings
*   **Inconsistent Data Flow:** Some updates go through stores (`usePatientStore.add`), while others invoke API or DB functions directly (`deleteCalendarEvent`, `db.calendarEvents.delete`) within components.

## 2. Business Logic & Complexity

### 🔴 Critical Issues
*   **Complex Logic in UI:**
    *   **Geocoding & Distance:** `SchedulePage.tsx` contains heavy logic for calculating distances and resolving coordinates. This should be isolated in a `RoutingService`.
    *   **CSV Parsing:** `PatientsPage.tsx` manually handles CSV parsing and deduplication. This logic is complex and hard to unit test when embedded in a React component.
*   **Race Conditions in "Auto-Arrange":** The `handleAutoArrangeDay` function in `SchedulePage.tsx` reads state, performs async operations, and then writes back to the DB. If the user interacts with the schedule during this process, data loss or corruption could occur.

## 3. Data Integrity & State Management

### 🔴 Critical Issues
*   **Optimistic Updates without Rollback:** The stores implement optimistic updates (updating UI before DB confirmation) but often lack robust rollback mechanisms if the DB operation fails.
*   **Sync Queue Reliability:** The `syncQueueDB` relies on `setTimeout` and memory-based processing. If the user closes the tab while an item is "processing," it might get stuck in that state. A robust "recovery on startup" mechanism is needed.

### 🟡 Warnings
*   **Global Singletons:** The use of exported objects like `patientDB` in `operations.ts` makes testing difficult. Dependency Injection or Module Mocking is required for effective unit testing.

## 4. Security & Safety

### 🔴 Critical Issues
*   **API Key Exposure:** `VITE_GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_CLIENT_ID` are exposed safely (as is standard for client-side apps). However, validation of `VITE_GOOGLE_SHEETS_ID` is minimal.
*   **Lack of Remote Validation:** The app trusts all data from Google Sheets blindly. Maliciously crafted sheet data could potentially cause XSS if rendered without sanitization (though React handles most of this, `dangerouslySetInnerHTML` usage should be audited).

### 🟡 Warnings
*   **Auth Token Storage:** The `getAccessToken` generic function (likely in `auth.ts`) needs to ensure tokens are handled securely and not stored in `localStorage` if possible (in-memory or HTTP-only cookies are preferred, though hard for pure client-side apps).

## 5. Type Safety (TypeScript)

### 🟡 Warnings
*   **Loose Typing in API:** The `GoogleApiErrorPayload` interface is very permissive (all optional fields).
*   **Manual Type Casting:** Frequent use of `as unknown as X` or forced non-null assertions (`!`) was observed in data parsing logic. This bypasses TypeScript's safety net.
*   **Zod Absence:** There is no runtime schema validation (like Zod) for external data (Google Sheets API responses, CSV imports). If the data shape changes, the app will crash at runtime.

## Recommendations

### Short-Term Refactoring (High Impact)
1.  **Extract Hooks:** Move logic from `SchedulePage.tsx` into `useScheduleLogic.ts`, `useAutoArrange.ts`, and `useGeocoding.ts`.
2.  **Service Layer:** Create a `PatientService` and `AppointmentService` class/module that encapsulates all DB and API interactions. The Stores should call these Services, not the DB directly.
3.  **Replace Event Bus:** Use a proper simplified "Sync Context" or standard Zustand middleware to trigger syncs.

### Long-Term Architecture
1.  **Zod Validation:** Implement Zod schemas for all domain entities (`Patient`, `Appointment`) and external API responses to ensure runtime safety.
2.  **Worker Threads:** Move heavy computations (Auto-Arrange, CSV parsing) to a Web Worker to keep the UI responsive.
3.  **Testing Strategy:** Introduce Vitest for unit testing the new Service and Hook layers. The current monolithic components are untestable.
