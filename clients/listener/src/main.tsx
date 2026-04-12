import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionPicker } from './pages/SessionPicker';
import { ListenPage } from './pages/ListenPage';
import './index.css';

function App() {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
