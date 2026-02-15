import { useMemo } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Sidebar } from "./components/ui/Sidebar";
import { TopNav } from "./components/ui/TopNav";
import { useSync } from "./hooks/useSync";
import { useAutoDischarge } from "./hooks/useAutoDischarge";
import { useSyncStore, useScheduleStore } from "./stores";
import {
  SchedulePage,
  PatientsPage,
  ScanPage,
  RoutePage,
  SettingsPage,
  PatientDetailPage,
} from "./pages";
import "./index.css";

function AppContent() {
  const { sidebarOpen, toggleSidebar, setSidebarOpen, selectedDate, setSelectedDate } = useScheduleStore();
  const location = useLocation();

  // Only show sidebar on schedule page
  const showSidebar = location.pathname === "/";

  // Convert ISO date string to Date object for Sidebar
  const selectedDateObj = new Date(selectedDate + "T12:00:00");

  return (
    <div className="h-screen bg-[var(--color-background)] flex flex-col overflow-hidden transition-colors duration-200">
      <TopNav
        onMenuClick={toggleSidebar}
        showMenuButton={showSidebar}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showSidebar && (
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            selectedDate={selectedDateObj}
            onDateSelect={(date) => setSelectedDate(date)}
          />
        )}
        <main className={`flex-1 min-h-0 min-w-0 overflow-auto ${showSidebar && sidebarOpen ? '' : ''}`}>
          <Routes>
            <Route path="/" element={<SchedulePage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<PatientDetailPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/route" element={<RoutePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  const { spreadsheetId, calendarId } = useSyncStore();
  const syncConfig = useMemo(
    () =>
      spreadsheetId || calendarId
        ? {
            spreadsheetId: spreadsheetId || undefined,
            calendarId: calendarId || undefined,
          }
        : null,
    [spreadsheetId, calendarId]
  );

  useSync(syncConfig);
  useAutoDischarge();

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
