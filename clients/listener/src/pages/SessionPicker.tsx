import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchActiveSessions, type SessionListItem } from '../lib/api';
import { ThemeToggle } from '../components/ThemeToggle';

export function SessionPicker() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadSessions = useCallback(async () => {
    try {
      const items = await fetchActiveSessions();
      setSessions(items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h1 className="text-lg font-semibold">Streamlate — Listener</h1>
        <ThemeToggle />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="text-xl font-medium mb-6" data-testid="picker-heading">
          Select a session to listen:
        </h2>

        {loading && (
          <div className="text-gray-400 text-center py-12" data-testid="loading">Loading sessions…</div>
        )}

        {error && (
          <div className="text-red-400 text-center py-12" data-testid="error">{error}</div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-gray-400 text-center py-12" data-testid="no-sessions">
            No active sessions available.
          </div>
        )}

        <div className="space-y-3" data-testid="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800 hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
              data-testid="session-card"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-medium" data-testid="session-name">{session.session_name}</span>
                    {session.has_pin && (
                      <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20" data-testid="pin-icon">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Translator: <span data-testid="translator-name">{session.translator_name}</span>
                    {' — '}
                    <DurationTimer startedAt={session.started_at} />
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {session.listener_count} listener{session.listener_count !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/listen/${session.id}`)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shrink-0 ml-4"
                  data-testid="listen-button"
                >
                  Listen
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-8 text-center">No account needed.</p>
      </main>
    </div>
  );
}

function DurationTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    function update() {
      const start = new Date(startedAt).getTime();
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span data-testid="duration">{elapsed}</span>;
}
