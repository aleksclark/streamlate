import { useEffect, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { api } from '../../api';
import type { SystemStatsResponse } from '../../api';
import { Skeleton } from '../../components/Skeleton';

export function AdminSettings() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const [stats, setStats] = useState<SystemStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.system.stats();
        setStats(data);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  const cardClass = `rounded-lg p-5 ${isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'}`;
  const labelClass = `text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`;
  const valueClass = `text-sm mt-1 ${isDark ? 'text-gray-200' : 'text-gray-800'}`;

  return (
    <div data-testid="admin-settings">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        System Settings
      </h1>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : stats ? (
        <div className="space-y-6">
          <div className={cardClass}>
            <h2 className={`text-sm font-semibold mb-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Server Information
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <div className={labelClass}>Version</div>
                <div className={valueClass}>{stats.version}</div>
              </div>
              <div>
                <div className={labelClass}>Uptime</div>
                <div className={valueClass}>{formatUptime(stats.uptime_seconds)}</div>
              </div>
              <div>
                <div className={labelClass}>Active Sessions</div>
                <div className={valueClass}>{stats.active_sessions}</div>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className={`text-sm font-semibold mb-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Database Statistics
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <div className={labelClass}>Total Users</div>
                <div className={valueClass}>{stats.total_users}</div>
              </div>
              <div>
                <div className={labelClass}>Total Booths</div>
                <div className={valueClass}>{stats.total_abcs}</div>
              </div>
              <div>
                <div className={labelClass}>Total Sessions</div>
                <div className={valueClass}>{stats.total_sessions}</div>
              </div>
              <div>
                <div className={labelClass}>Connected Booths</div>
                <div className={valueClass}>{stats.connected_abcs}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Failed to load system settings.
        </p>
      )}
    </div>
  );
}
