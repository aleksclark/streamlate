import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { AdminGuard } from './components/AdminGuard';
import { AdminLayout } from './components/AdminLayout';
import { ToastContainer } from './components/ToastContainer';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionPage } from './pages/SessionPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminAbcs } from './pages/admin/AdminAbcs';
import { AdminSessions } from './pages/admin/AdminSessions';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminRecordings } from './pages/admin/AdminRecordings';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <DashboardPage />
              </AuthGuard>
            }
          />
          <Route
            path="/session/:sessionId"
            element={
              <AuthGuard>
                <SessionPage />
              </AuthGuard>
            }
          />
          <Route
            path="/admin"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminDashboard /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminUsers /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/abcs"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminAbcs /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/sessions"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminSessions /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/recordings"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminRecordings /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <AuthGuard>
                <AdminGuard>
                  <AdminLayout><AdminSettings /></AdminLayout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <ToastContainer />
    </BrowserRouter>
  );
}
