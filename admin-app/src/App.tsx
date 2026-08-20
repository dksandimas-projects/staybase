import { Routes, Route, Navigate } from "react-router-dom";
import { AdminProvider } from "./context/AdminContext";
import { AdminLayout } from "./components/AdminLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { BookingsPage } from "./pages/BookingsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { RoomsPage } from "./pages/RoomsPage";
import { RatesPage } from "./pages/RatesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { CorporateInquiriesPage } from "./pages/CorporateInquiriesPage";
import { IntercomInboxPage } from "./pages/IntercomInboxPage";
import { QRManagementPage } from "./pages/QRManagementPage";
import { MembersPage } from "./pages/MembersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AudioSettingsPage } from "./pages/AudioSettingsPage";

export function App() {
  return (
    <AdminProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        {/* Protected Dashboard Shell */}
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/rates" element={<RatesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/corporate" element={<CorporateInquiriesPage />} />
          <Route path="/intercom" element={<IntercomInboxPage />} />
          <Route path="/qr" element={<QRManagementPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audio" element={<AudioSettingsPage />} />
        </Route>

        {/* Fallback routing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminProvider>
  );
}
