import { create } from 'zustand';
import { api } from '../api';
import type { RecordingResponse, RecordingMetadataResponse } from '../api';

interface RecordingsState {
  recordings: RecordingResponse[];
  loading: boolean;
  error: string | null;
  currentRecording: RecordingMetadataResponse | null;
  currentLoading: boolean;
  fetchRecordings: () => Promise<void>;
  fetchRecording: (id: string) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<void>;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => ({
  recordings: [],
  loading: false,
  error: null,
  currentRecording: null,
  currentLoading: false,

  fetchRecordings: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.recordings.list();
      set({ recordings: data.items, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchRecording: async (id: string) => {
    set({ currentLoading: true });
    try {
      const data = await api.recordings.get(id);
      set({ currentRecording: data, currentLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, currentLoading: false });
    }
  },

  deleteRecording: async (id: string) => {
    await api.recordings.delete(id);
    set({ recordings: get().recordings.filter((r) => r.id !== id) });
  },

  bulkDelete: async (ids: string[]) => {
    await api.recordings.bulkDelete(ids);
    set({ recordings: get().recordings.filter((r) => !ids.includes(r.id)) });
  },
}));
