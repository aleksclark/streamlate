import { create } from 'zustand';
import { api, configureApiClient } from '../api';
import type { User } from '../api';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<string | null>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  configureApiClient({
    getToken: () => get().token,
    refreshToken: () => get().refreshToken(),
    onUnauthorized: () => get().logout(),
  });

  return {
    token: null,
    user: null,
    isAuthenticated: false,
    isInitialized: false,

    login: async (email: string, password: string) => {
      const data = await api.auth.login({ email, password });
      set({
        token: data.access_token,
        user: data.user,
        isAuthenticated: true,
      });
      scheduleRefresh(data.expires_in);
    },

    logout: () => {
      api.auth.logout().catch(() => {});
      clearRefreshTimer();
      set({ token: null, user: null, isAuthenticated: false });
    },

    refreshToken: async () => {
      try {
        const data = await api.auth.refresh();
        set({ token: data.access_token });
        scheduleRefresh(data.expires_in);
        return data.access_token;
      } catch {
        set({ token: null, user: null, isAuthenticated: false });
        return null;
      }
    },

    initialize: async () => {
      try {
        const data = await api.auth.refresh();
        set({ token: data.access_token, isAuthenticated: true });
        scheduleRefresh(data.expires_in);
        const me = await api.auth.me();
        set({ user: me as User });
      } catch {
        set({ token: null, user: null, isAuthenticated: false });
      } finally {
        set({ isInitialized: true });
      }
    },
  };
});

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(expiresInSec: number) {
  clearRefreshTimer();
  const refreshAfterMs = Math.max((expiresInSec - 60) * 1000, 10_000);
  _refreshTimer = setTimeout(() => {
    useAuthStore.getState().refreshToken();
  }, refreshAfterMs);
}

function clearRefreshTimer() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}
