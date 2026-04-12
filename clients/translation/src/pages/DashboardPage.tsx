import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useDashboardStore } from '../stores/dashboardStore';
import { useThemeStore } from '../stores/themeStore';
import { api } from '../api';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { abcs, sessions, loading, error, refresh } = useDashboardStore();
  const theme = useThemeStore((s) => s.theme);
  const navigate = useNavigate();

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleStart = async (abcId: string) => {
    const abcItem = abcs.find((a) => a.id === abcId);
    const sessionName = abcItem ? `Session - ${abcItem.name}` : 'Translation Session';

    try {
      const session = await api.sessions.create({
        abc_id: abcId,
        session_name: sessionName,
      });
      navigate(`/session/${session.id}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" data-testid="dashboard">
      <div className="mb-8">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Dashboard
        </h1>
        {user && (
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Welcome back, {user.display_name}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-900/20 border border-red-500/30 text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          Available Booths
        </h2>

        {loading && abcs.length === 0 && (
          <div className="flex items-center gap-2">
            <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${
              isDark ? 'border-blue-400' : 'border-blue-600'
            }`} />
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Loading booths...
            </span>
          </div>
        )}

        {!loading && abcs.length === 0 && (
          <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No audio booth connectors registered.
          </p>
        )}

        <div data-testid="abc-list" className="space-y-2">
          {abcs.map((abc) => (
            <div
              key={abc.id}
              data-testid={`abc-item-${abc.id}`}
              className={`flex items-center justify-between p-4 rounded-lg transition-colors ${
                isDark
                  ? 'bg-gray-900 hover:bg-gray-800/80'
                  : 'bg-white border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  data-testid={`abc-status-${abc.id}`}
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    abc.online ? 'bg-green-500' : 'bg-gray-500'
                  }`}
                />
                <div>
                  <span data-testid={`abc-name-${abc.id}`} className="font-medium">
                    {abc.name}
                  </span>
                  <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {abc.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
              <button
                data-testid={`abc-start-${abc.id}`}
                onClick={() => handleStart(abc.id)}
                disabled={!abc.online}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Start Session
              </button>
            </div>
          ))}
        </div>
      </section>

      {sessions.length > 0 && (
        <section>
          <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
            Active Sessions
          </h2>
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`flex items-center justify-between p-4 rounded-lg ${
                  isDark
                    ? 'bg-gray-900'
                    : 'bg-white border border-gray-200'
                }`}
              >
                <div>
                  <span className="font-medium">{session.session_name}</span>
                  <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {session.state}
                  </span>
                </div>
                <button
                  onClick={() => navigate(`/session/${session.id}`)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    isDark
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  Rejoin
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
