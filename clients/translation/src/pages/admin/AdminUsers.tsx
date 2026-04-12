import { useEffect, useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { api, ApiClientError } from '../../api';
import type { UserResponse, CreateUserRequest, UpdateUserRequest } from '../../api';
import { TableSkeleton } from '../../components/Skeleton';

export function AdminUsers() {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const addToast = useToastStore((s) => s.addToast);
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<UserResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.users.list();
      setUsers(data.items);
    } catch {
      addToast('error', 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: CreateUserRequest) => {
    try {
      await api.users.create(data);
      addToast('success', `User "${data.email}" created`);
      setShowCreate(false);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to create user';
      addToast('error', msg);
    }
  };

  const handleUpdate = async (id: string, data: UpdateUserRequest) => {
    try {
      await api.users.update(id, data);
      addToast('success', 'User updated');
      setEditUser(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to update user';
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.users.delete(id);
      addToast('success', 'User deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Failed to delete user';
      addToast('error', msg);
    }
  };

  const cardClass = isDark ? 'bg-gray-900' : 'bg-white border border-gray-200';
  const inputClass = `w-full px-3 py-2 rounded-lg text-sm ${
    isDark
      ? 'bg-gray-800 border-gray-700 text-gray-100 focus:border-blue-500'
      : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500'
  } border outline-none`;

  return (
    <div data-testid="admin-users">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          User Management
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          data-testid="create-user-btn"
        >
          Create User
        </button>
      </div>

      {showCreate && (
        <UserForm
          title="Create User"
          cardClass={cardClass}
          inputClass={inputClass}
          isDark={isDark}
          onSubmit={(data) => handleCreate(data as CreateUserRequest)}
          onCancel={() => setShowCreate(false)}
          isCreate
        />
      )}

      {editUser && (
        <UserForm
          title={`Edit ${editUser.display_name}`}
          cardClass={cardClass}
          inputClass={inputClass}
          isDark={isDark}
          initial={editUser}
          onSubmit={(data) => handleUpdate(editUser.id, data as UpdateUserRequest)}
          onCancel={() => setEditUser(null)}
        />
      )}

      {deleteConfirm && (
        <div className={`mb-4 p-4 rounded-lg ${isDark ? 'bg-red-900/30 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm mb-3 ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            Are you sure you want to delete this user? This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleDelete(deleteConfirm)}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              data-testid="confirm-delete-btn"
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                <th className="text-left py-2 px-3 font-medium">Email</th>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Role</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Created</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={`border-t ${isDark ? 'border-gray-800' : 'border-gray-100'}`}
                  data-testid={`user-row-${user.id}`}
                >
                  <td className="py-3 px-3">{user.email}</td>
                  <td className="py-3 px-3">{user.display_name}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-900/40 text-purple-300'
                        : 'bg-blue-900/40 text-blue-300'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-3 hidden sm:table-cell">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditUser(user)}
                        className={`px-2 py-1 text-xs rounded ${
                          isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                        data-testid={`edit-user-${user.id}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(user.id)}
                        disabled={user.id === currentUser?.id}
                        className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
                        data-testid={`delete-user-${user.id}`}
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

function UserForm({
  title,
  cardClass,
  inputClass,
  isDark,
  initial,
  onSubmit,
  onCancel,
  isCreate,
}: {
  title: string;
  cardClass: string;
  inputClass: string;
  isDark: boolean;
  initial?: UserResponse;
  onSubmit: (data: CreateUserRequest | UpdateUserRequest) => void;
  onCancel: () => void;
  isCreate?: boolean;
}) {
  const [email, setEmail] = useState(initial?.email ?? '');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(initial?.role ?? 'translator');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreate) {
      onSubmit({ email, password, display_name: displayName, role });
    } else {
      const update: UpdateUserRequest = {};
      if (email !== initial?.email) update.email = email;
      if (displayName !== initial?.display_name) update.display_name = displayName;
      if (password) update.password = password;
      if (role !== initial?.role) update.role = role;
      onSubmit(update);
    }
  };

  return (
    <div className={`mb-6 p-4 rounded-lg ${cardClass}`}>
      <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        {title}
      </h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          className={inputClass}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={!!isCreate}
          data-testid="user-email-input"
        />
        <input
          className={inputClass}
          placeholder="Display Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required={!!isCreate}
          data-testid="user-name-input"
        />
        <input
          className={inputClass}
          placeholder={isCreate ? 'Password' : 'New Password (leave empty to keep)'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!!isCreate}
          minLength={isCreate ? 8 : undefined}
          data-testid="user-password-input"
        />
        <select
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          data-testid="user-role-select"
        >
          <option value="translator">Translator</option>
          <option value="admin">Admin</option>
        </select>
        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            data-testid="user-submit-btn"
          >
            {isCreate ? 'Create' : 'Update'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-2 text-sm rounded-lg ${
              isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
