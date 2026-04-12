import { useEffect, useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useToastStore } from '../../stores/toastStore';
import { api, ApiClientError } from '../../api';
import type { RecordingResponse } from '../../api';
import { TableSkeleton } from '../../components/Skeleton';

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function AdminRecordings() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const addToast = useToastStore((s) => s.addToast);
  const [recordings, setRecordings] = useState<RecordingResponse[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.recordings.list();
      setRecordings(data.items);
      setTotalSize(data.total_size_bytes);
    } catch {
      addToast('error', 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await api.recordings.delete(id);
      addToast('success', 'Recording deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to delete recording';
      addToast('error', msg);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    let deleted = 0;
    for (const id of ids) {
      try {
        await api.recordings.delete(id);
        deleted++;
      } catch {
        // continue
      }
    }
    addToast('success', `Deleted ${deleted} recording(s)`);
    setSelected(new Set());
    setBulkDeleteConfirm(false);
    load();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.id)));
    }
  };

  const filtered = recordings.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.session_id.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
  });

  return (
    <div data-testid="admin-recordings">
      <div className="flex items-center justify-between mb-4">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Recordings
        </h1>
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Total: {formatBytes(totalSize)}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className={`flex-1 px-3 py-2 rounded-lg text-sm border outline-none ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-gray-100'
              : 'bg-gray-50 border-gray-300 text-gray-900'
          }`}
          placeholder="Search by session ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="recording-search"
        />
        {selected.size > 0 && (
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 shrink-0"
            data-testid="bulk-delete-btn"
          >
            Delete ({selected.size})
          </button>
        )}
      </div>

      {(deleteConfirm || bulkDeleteConfirm) && (
        <div className={`mb-4 p-4 rounded-lg ${isDark ? 'bg-red-900/30 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm mb-3 ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            {bulkDeleteConfirm
              ? `Delete ${selected.size} recording(s)? This cannot be undone.`
              : 'Delete this recording? This cannot be undone.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => bulkDeleteConfirm ? handleBulkDelete() : deleteConfirm && handleDelete(deleteConfirm)}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              data-testid="confirm-delete-btn"
            >
              Delete
            </button>
            <button
              onClick={() => { setDeleteConfirm(null); setBulkDeleteConfirm(false); }}
              className={`px-3 py-1.5 text-sm rounded-lg ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : filtered.length === 0 ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {recordings.length === 0 ? 'No recordings yet.' : 'No recordings match your search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                <th className="text-left py-2 px-3 font-medium w-8">
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                <th className="text-left py-2 px-3 font-medium">Session</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Duration</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Size</th>
                <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Created</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => (
                <tr key={rec.id} className={`border-t ${isDark ? 'border-gray-800' : 'border-gray-100'}`} data-testid={`recording-row-${rec.id}`}>
                  <td className="py-3 px-3">
                    <input type="checkbox" checked={selected.has(rec.id)} onChange={() => toggleSelect(rec.id)} />
                  </td>
                  <td className="py-3 px-3 font-mono text-xs">{rec.session_id.slice(0, 8)}…</td>
                  <td className="py-3 px-3 hidden sm:table-cell">{formatDuration(rec.duration_seconds)}</td>
                  <td className="py-3 px-3 hidden sm:table-cell">{formatBytes(rec.size_bytes)}</td>
                  <td className="py-3 px-3 hidden md:table-cell text-xs">{new Date(rec.created_at).toLocaleString()}</td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => setDeleteConfirm(rec.id)}
                      className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
                      data-testid={`delete-recording-${rec.id}`}
                    >
                      Delete
                    </button>
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
