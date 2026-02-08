import { useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Sidebar } from "./components/ui/Sidebar";
import { TopNav } from "./components/ui/TopNav";
import { useSync } from "./hooks/useSync";
import { useSyncStore } from "./stores";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();

  // Only show sidebar on schedule page
  const showSidebar = location.pathname === "/";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <TopNav
        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        showMenuButton={showSidebar}
      />
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        )}
        <main className={`flex-1 overflow-auto ${showSidebar && sidebarOpen ? '' : ''}`}>
          <Routes>
            <Route path="/" element={<SchedulePage sidebarOpen={sidebarOpen} />} />
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

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
