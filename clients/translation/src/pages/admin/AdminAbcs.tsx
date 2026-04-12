import { useEffect, useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useToastStore } from '../../stores/toastStore';
import { api, ApiClientError } from '../../api';
import type { AbcResponse, AbcStatus } from '../../api';
import { TableSkeleton } from '../../components/Skeleton';

interface AbcItem extends AbcResponse {
  online: boolean;
}

export function AdminAbcs() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const addToast = useToastStore((s) => s.addToast);
  const [abcs, setAbcs] = useState<AbcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [newCreds, setNewCreds] = useState<{ id: string; secret: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.abcs.list();
      const items = await Promise.all(
        data.items.map(async (abc: AbcResponse) => {
          try {
            const status: AbcStatus = await api.abcs.status(abc.id);
            return { ...abc, online: status.online };
          } catch {
            return { ...abc, online: false };
          }
        })
      );
      setAbcs(items);
    } catch {
      addToast('error', 'Failed to load booths');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    try {
      const result = await api.abcs.create({ name: createName.trim() });
      setNewCreds({ id: result.id, secret: result.secret });
      addToast('success', `Booth "${createName}" registered`);
      setShowCreate(false);
      setCreateName('');
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to create booth';
      addToast('error', msg);
    }
  };

  const handleUpdate = async () => {
    if (!editId || !editName.trim()) return;
    try {
      await api.abcs.update(editId, { name: editName.trim() });
      addToast('success', 'Booth updated');
      setEditId(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to update booth';
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.abcs.delete(id);
      addToast('success', 'Booth deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to delete booth';
      addToast('error', msg);
    }
  };

  const handleRotate = async (id: string) => {
    try {
      const result = await api.abcs.rotateSecret(id);
      setNewCreds({ id: result.id, secret: result.secret });
      addToast('success', 'Secret rotated');
      setRotateConfirm(null);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to rotate secret';
      addToast('error', msg);
    }
  };

  const cardClass = isDark ? 'bg-gray-900' : 'bg-white border border-gray-200';
  const inputClass = `w-full px-3 py-2 rounded-lg text-sm ${
    isDark
      ? 'bg-gray-800 border-gray-700 text-gray-100'
      : 'bg-gray-50 border-gray-300 text-gray-900'
  } border outline-none`;

  return (
    <div data-testid="admin-abcs">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Booth Management
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          data-testid="register-abc-btn"
        >
          Register Booth
        </button>
      </div>

      {newCreds && (
        <div className={`mb-4 p-4 rounded-lg ${isDark ? 'bg-yellow-900/30 border border-yellow-800' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className={`text-sm font-semibold mb-2 ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
            ⚠ Save these credentials now. The secret will not be shown again.
          </p>
          <div className="space-y-1 text-sm font-mono">
            <div>
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>ID: </span>
              <span className="select-all" data-testid="abc-credentials-id">{newCreds.id}</span>
            </div>
            <div>
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Secret: </span>
              <span className="select-all" data-testid="abc-credentials-secret">{newCreds.secret}</span>
            </div>
          </div>
          <button
            onClick={() => setNewCreds(null)}
            className="mt-3 px-3 py-1 text-xs rounded bg-yellow-600/30 hover:bg-yellow-600/40"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <div className={`mb-4 p-4 rounded-lg ${cardClass}`}>
          <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
            Register New Booth
          </h3>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="Booth Name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              data-testid="abc-name-input"
            />
            <button onClick={handleCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shrink-0" data-testid="abc-submit-btn">Create</button>
            <button onClick={() => setShowCreate(false)} className={`px-4 py-2 text-sm rounded-lg shrink-0 ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>Cancel</button>
          </div>
        </div>
      )}

      {(deleteConfirm || rotateConfirm) && (
        <div className={`mb-4 p-4 rounded-lg ${isDark ? 'bg-red-900/30 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm mb-3 ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            {deleteConfirm
              ? 'Are you sure you want to delete this booth?'
              : 'Rotating the secret will invalidate the existing device. Continue?'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteConfirm ? handleDelete(deleteConfirm) : rotateConfirm && handleRotate(rotateConfirm)}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              data-testid="confirm-action-btn"
            >
              Confirm
            </button>
            <button
              onClick={() => { setDeleteConfirm(null); setRotateConfirm(null); }}
              className={`px-3 py-1.5 text-sm rounded-lg ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : abcs.length === 0 ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No booths registered yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Created</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {abcs.map((abc) => (
                <tr
                  key={abc.id}
                  className={`border-t ${isDark ? 'border-gray-800' : 'border-gray-100'}`}
                  data-testid={`abc-row-${abc.id}`}
                >
                  <td className="py-3 px-3">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${abc.online ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="ml-2 text-xs">{abc.online ? 'Online' : 'Offline'}</span>
                  </td>
                  <td className="py-3 px-3">
                    {editId === abc.id ? (
                      <div className="flex gap-2">
                        <input
                          className={inputClass}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          data-testid="abc-edit-name-input"
                        />
                        <button onClick={handleUpdate} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Save</button>
                        <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs bg-gray-600 text-white rounded">Cancel</button>
                      </div>
                    ) : (
                      abc.name
                    )}
                  </td>
                  <td className="py-3 px-3 hidden sm:table-cell">
                    {new Date(abc.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => { setEditId(abc.id); setEditName(abc.name); }}
                        className={`px-2 py-1 text-xs rounded ${isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                        data-testid={`edit-abc-${abc.id}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setRotateConfirm(abc.id)}
                        className="px-2 py-1 text-xs rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
                        data-testid={`rotate-abc-${abc.id}`}
                      >
                        Rotate Secret
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(abc.id)}
                        className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
                        data-testid={`delete-abc-${abc.id}`}
                      >
                        Delete
                      </button>
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
