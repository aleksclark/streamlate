import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';

export function Layout({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const navigate = useNavigate();
  const location = useLocation();

  const isLoginPage = location.pathname === '/login';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${
      theme === 'dark'
        ? 'bg-gray-950 text-gray-100'
        : 'bg-gray-50 text-gray-900'
    }`}>
      {!isLoginPage && (
        <header className={`border-b px-4 py-3 flex items-center justify-between ${
          theme === 'dark'
            ? 'border-gray-800 bg-gray-900'
            : 'border-gray-200 bg-white'
        }`}>
          <button
            onClick={() => navigate('/')}
            className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            Streamlate
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg transition-colors ${
                theme === 'dark'
                  ? 'hover:bg-gray-800 text-gray-400'
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {user && (
              <div className="flex items-center gap-3">
                {user.role === 'admin' && (
                  <button
                    onClick={() => navigate(location.pathname.startsWith('/admin') ? '/' : '/admin')}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      location.pathname.startsWith('/admin')
                        ? 'bg-blue-600 text-white'
                        : theme === 'dark'
                          ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                    data-testid="admin-link"
                  >
                    {location.pathname.startsWith('/admin') ? 'Dashboard' : 'Admin'}
                  </button>
                )}
                <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {user.display_name}
                </span>
                <button
                  data-testid="logout-button"
                  onClick={handleLogout}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    theme === 'dark'
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>
      )}
      <main>{children}</main>
    </div>
  );
}
