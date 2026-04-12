import { useEffect, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { api } from '../../api';
import type { SystemStatsResponse } from '../../api';
import { Skeleton } from '../../components/Skeleton';

export function AdminDashboard() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const [stats, setStats] = useState<SystemStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.system.stats();
        setStats(data);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  const cards = stats
    ? [
        { label: 'Active Sessions', value: stats.active_sessions, color: 'text-green-500' },
        { label: 'Connected Booths', value: stats.connected_abcs, color: 'text-blue-500' },
        { label: 'Total Users', value: stats.total_users, color: 'text-purple-500' },
        { label: 'Total Booths', value: stats.total_abcs, color: 'text-cyan-500' },
        { label: 'Total Sessions', value: stats.total_sessions, color: 'text-amber-500' },
        { label: 'Uptime', value: formatUptime(stats.uptime_seconds), color: 'text-gray-400' },
      ]
    : [];

  return (
    <div data-testid="admin-dashboard">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Admin Overview
      </h1>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className={`rounded-lg p-4 ${
                isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'
              }`}
            >
              <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                {card.label}
              </div>
              <div className={`text-2xl font-bold ${card.color}`}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className={`mt-6 text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          Server v{stats.version}
        </div>
      )}
    </div>
  );
}
