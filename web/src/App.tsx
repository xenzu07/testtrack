import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import Layout from './Layout';
import LoginPage from './pages/LoginPage';
import ReportsPage from './pages/ReportsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import JobOrdersPage from './pages/JobOrdersPage';
import UsersPage from './pages/UsersPage';
import OverviewPage from './pages/OverviewPage';
import TechniciansPage from './pages/TechniciansPage';
import RoutingQueuePage from './pages/RoutingQueuePage';
import FormsPage from './pages/FormsPage';
import FormDetailPage from './pages/FormDetailPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TechnicianAnalyticsPage from './pages/TechnicianAnalyticsPage';

// the API enforces roles; this only keeps other roles off admin-only screens
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <>{children}</> : <Navigate to="/overview" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Layout />}>
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/queue" element={<RoutingQueuePage />} />
              <Route path="/forms" element={<FormsPage />} />
              <Route path="/forms/:id" element={<FormDetailPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/analytics/technicians/:id" element={<TechnicianAnalyticsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reports/:id" element={<ReportDetailPage />} />
              <Route path="/job-orders" element={<JobOrdersPage />} />
              <Route path="/technicians" element={<TechniciansPage />} />
              <Route
                path="/users"
                element={
                  <AdminOnly>
                    <UsersPage />
                  </AdminOnly>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}