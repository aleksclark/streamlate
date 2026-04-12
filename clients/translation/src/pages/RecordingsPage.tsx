import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordingsStore } from '../stores/recordingsStore';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecordingsPage() {
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);
  const { recordings, loading, error, fetchRecordings, bulkDelete } = useRecordingsStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isDark = theme === 'dark';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    await bulkDelete(Array.from(selected));
    setSelected(new Set());
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" data-testid="recordings-page">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Recordings
          </h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Review past translation sessions
          </p>
        </div>
        {isAdmin && selected.size > 0 && (
          <button
            onClick={handleBulkDelete}
            data-testid="bulk-delete-btn"
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Delete {selected.size} selected
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-900/20 border border-red-500/30 text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading && recordings.length === 0 && (
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${
            isDark ? 'border-blue-400' : 'border-blue-600'
          }`} />
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Loading recordings...
          </span>
        </div>
      )}

      {!loading && recordings.length === 0 && (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No recordings yet.
        </p>
      )}

      <div className="space-y-2" data-testid="recordings-list">
        {recordings.map((rec) => (
          <div
            key={rec.id}
            data-testid={`recording-${rec.id}`}
            className={`flex items-center gap-3 p-4 rounded-lg transition-colors cursor-pointer ${
              isDark
                ? 'bg-gray-900 hover:bg-gray-800/80'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => navigate(`/recordings/${rec.id}`)}
          >
            {isAdmin && (
              <input
                type="checkbox"
                checked={selected.has(rec.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelect(rec.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="rounded"
                data-testid={`select-${rec.id}`}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{rec.session_name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  rec.state === 'completed'
                    ? isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700'
                    : rec.state === 'failed'
                    ? isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700'
                    : isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {rec.state}
                </span>
              </div>
              <div className={`text-xs mt-1 flex items-center gap-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <span>{formatDate(rec.started_at)}</span>
                <span>{formatDuration(rec.duration_seconds)}</span>
                <span>{formatSize(rec.size_bytes)}</span>
              </div>
            </div>
            <svg className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
