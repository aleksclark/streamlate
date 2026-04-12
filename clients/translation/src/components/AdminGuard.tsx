import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { ReactNode } from 'react';

export function AdminGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
