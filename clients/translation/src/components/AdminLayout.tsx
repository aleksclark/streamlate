import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useThemeStore } from '../stores/themeStore';

const navItems = [
  { path: '/admin', label: 'Overview', icon: '📊' },
  { path: '/admin/users', label: 'Users', icon: '👤' },
  { path: '/admin/abcs', label: 'Booths', icon: '🎙' },
  { path: '/admin/sessions', label: 'Sessions', icon: '📡' },
  { path: '/admin/recordings', label: 'Recordings', icon: '🎵' },
  { path: '/admin/settings', label: 'Settings', icon: '⚙' },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-[calc(100vh-53px)]">
      <button
        className={`md:hidden fixed top-[60px] left-2 z-40 p-2 rounded-lg ${
          isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700 border border-gray-200'
        }`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        data-testid="admin-menu-toggle"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed md:static z-30 top-[53px] left-0 h-[calc(100vh-53px)] w-56 transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${
          isDark
            ? 'bg-gray-900 border-r border-gray-800'
            : 'bg-white border-r border-gray-200'
        }`}
        data-testid="admin-sidebar"
      >
        <nav className="py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? isDark
                      ? 'bg-blue-900/40 text-blue-300'
                      : 'bg-blue-50 text-blue-700'
                    : isDark
                      ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                data-testid={`admin-nav-${item.label.toLowerCase()}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 p-4 sm:p-6 md:pl-6 min-w-0">
        {children}
      </main>
    </div>
  );
}
