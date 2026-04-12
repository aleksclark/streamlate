import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ListenPage } from './pages/ListenPage';
import { SessionPicker } from './pages/SessionPicker';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/listen" element={<SessionPicker />} />
        <Route path="/listen/:sessionId" element={<ListenPage />} />
        <Route path="*" element={<Navigate to="/listen" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
