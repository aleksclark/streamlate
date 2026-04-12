import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { ApiClientError } from '../api';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const theme = useThemeStore((s) => s.theme);
  const navigate = useNavigate();

  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen flex items-center justify-center ${
      isDark ? 'bg-gray-950' : 'bg-gray-50'
    }`}>
      <form
        data-testid="login-form"
        onSubmit={handleSubmit}
        className={`w-full max-w-md p-8 rounded-xl shadow-lg ${
          isDark ? 'bg-gray-900' : 'bg-white'
        }`}
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Streamlate
            </h1>
            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Translation Client
            </p>
          </div>
        </div>

        {error && (
          <div
            data-testid="login-error"
            className="mb-4 p-3 bg-red-900/20 border border-red-500/30 text-red-400 rounded-lg text-sm"
          >
            {error}
          </div>
        )}

        <div className="mb-4">
          <label htmlFor="email" className={`block text-sm font-medium mb-1.5 ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>Email</label>
          <input
            id="email"
            data-testid="email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full p-2.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
              isDark
                ? 'bg-gray-800 text-white border-gray-700 focus:border-blue-500'
                : 'bg-gray-50 text-gray-900 border-gray-300 focus:border-blue-500'
            }`}
            required
            autoComplete="email"
          />
        </div>

        <div className="mb-6">
          <label htmlFor="password" className={`block text-sm font-medium mb-1.5 ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>Password</label>
          <input
            id="password"
            data-testid="password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full p-2.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
              isDark
                ? 'bg-gray-800 text-white border-gray-700 focus:border-blue-500'
                : 'bg-gray-50 text-gray-900 border-gray-300 focus:border-blue-500'
            }`}
            required
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          data-testid="login-submit"
          disabled={loading}
          className="w-full p-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Signing in...
            </span>
          ) : (
            'Sign In'
          )}
        </button>
      </form>
    </div>
  );
}
