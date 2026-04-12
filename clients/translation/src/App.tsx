import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionPage } from './pages/SessionPage';
import { RecordingsPage } from './pages/RecordingsPage';
import { PlaybackPage } from './pages/PlaybackPage';

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
            path="/recordings"
            element={
              <AuthGuard>
                <RecordingsPage />
              </AuthGuard>
            }
          />
          <Route
            path="/recordings/:id"
            element={
              <AuthGuard>
                <PlaybackPage />
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
