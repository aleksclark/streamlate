import { create } from 'zustand';
import { api } from '../api';
import type { SessionResponse } from '../api';

export interface AbcItem {
  id: string;
  name: string;
  online: boolean;
  activeSessionId?: string;
}

interface DashboardState {
  abcs: AbcItem[];
  sessions: SessionResponse[];
  loading: boolean;
  error: string | null;
  fetchAbcs: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  abcs: [],
  sessions: [],
  loading: false,
  error: null,

  fetchAbcs: async () => {
    try {
      const data = await api.abcs.list();
      const statusPromises = data.items.map(async (abc) => {
        try {
          const status = await api.abcs.status(abc.id);
          return { id: abc.id, name: abc.name, online: status.online };
        } catch {
          return { id: abc.id, name: abc.name, online: false };
        }
      });

      const abcs = await Promise.all(statusPromises);
      set({ abcs });
    } catch {
      set({ error: 'Failed to load booths' });
    }
  },

  fetchSessions: async () => {
    try {
      const data = await api.sessions.list('active');
      set({ sessions: data.items });
    } catch {
      // Silently fail on session list
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    const store = useDashboardStore.getState();
    await Promise.all([store.fetchAbcs(), store.fetchSessions()]);
    set({ loading: false });
  },
}));
