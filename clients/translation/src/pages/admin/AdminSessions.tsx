import { useEffect, useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useToastStore } from '../../stores/toastStore';
import { api, ApiClientError } from '../../api';
import type { SessionResponse } from '../../api';
import { TableSkeleton } from '../../components/Skeleton';
import { QRCodeSVG } from 'qrcode.react';

export function AdminSessions() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const addToast = useToastStore((s) => s.addToast);
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [stopConfirm, setStopConfirm] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.sessions.list(filter || undefined);
      setSessions(data.items);
    } catch {
      addToast('error', 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [addToast, filter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleForceStop = async (id: string) => {
    try {
      await api.sessions.stop(id);
      addToast('success', 'Session stopped');
      setStopConfirm(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to stop session';
      addToast('error', msg);
    }
  };

  function stateColor(state: string): string {
    switch (state) {
      case 'active':
      case 'passthrough':
        return 'bg-green-500';
      case 'starting':
      case 'paused':
        return 'bg-amber-500';
      case 'completed':
        return 'bg-gray-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  }

  function isActive(state: string): boolean {
    return ['starting', 'active', 'paused', 'passthrough'].includes(state);
  }

  function listenerUrl(sessionId: string): string {
    return typeof window !== 'undefined'
      ? `${window.location.origin}/listen/${sessionId}`
      : `/listen/${sessionId}`;
  }

  const filterClass = `px-3 py-1.5 text-xs rounded-lg transition-colors`;

  return (
    <div data-testid="admin-sessions">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Session Management
      </h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {['', 'active', 'completed', 'failed'].map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setLoading(true); }}
            className={`${filterClass} ${
              filter === f
                ? 'bg-blue-600 text-white'
                : isDark
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            data-testid={`filter-${f || 'all'}`}
          >
            {f === '' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {stopConfirm && (
        <div className={`mb-4 p-4 rounded-lg ${isDark ? 'bg-red-900/30 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm mb-3 ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            Force stop this session? All participants will be disconnected.
          </p>
          <div className="flex gap-2">
            <button onClick={() => handleForceStop(stopConfirm)} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700" data-testid="confirm-stop-btn">Force Stop</button>
            <button onClick={() => setStopConfirm(null)} className={`px-3 py-1.5 text-sm rounded-lg ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>Cancel</button>
          </div>
        </div>
      )}

      {showQR && (
        <div className={`mb-4 p-4 rounded-lg text-center ${isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'}`}>
          <div className="bg-white p-4 rounded-lg inline-block mb-2" data-testid="session-qr-code">
            <QRCodeSVG value={listenerUrl(showQR)} size={200} />
          </div>
          <p className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Scan to listen
          </p>
          <p className={`text-xs font-mono mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {listenerUrl(showQR)}
          </p>
          <button onClick={() => setShowQR(null)} className={`px-3 py-1 text-xs rounded ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>Close</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : sessions.length === 0 ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No sessions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                <th className="text-left py-2 px-3 font-medium">State</th>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Started</th>
                <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Ended</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={`border-t ${isDark ? 'border-gray-800' : 'border-gray-100'}`} data-testid={`session-row-${s.id}`}>
                  <td className="py-3 px-3">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${stateColor(s.state)}`} />
                    <span className="ml-2 text-xs">{s.state}</span>
                  </td>
                  <td className="py-3 px-3">{s.session_name}</td>
                  <td className="py-3 px-3 hidden sm:table-cell text-xs">
                    {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-3 px-3 hidden md:table-cell text-xs">
                    {s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex justify-end gap-2">
                      {isActive(s.state) && (
                        <>
                          <button
                            onClick={() => setShowQR(s.id)}
                            className={`px-2 py-1 text-xs rounded ${isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                            data-testid={`qr-session-${s.id}`}
                          >
                            QR
                          </button>
                          <button
                            onClick={() => setStopConfirm(s.id)}
                            className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
                            data-testid={`stop-session-${s.id}`}
                          >
                            Force Stop
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
