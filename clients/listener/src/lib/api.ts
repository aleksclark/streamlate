const API_BASE = '/api/v1';

export interface SessionListItem {
  id: string;
  session_name: string;
  translator_name: string;
  started_at: string;
  listener_count: number;
  has_pin: boolean;
  state: string;
}

export interface SessionListResponse {
  items: SessionListItem[];
  cursor: string | null;
}

export interface ListenResponse {
  signaling_url: string;
}

export interface SessionDetail {
  id: string;
  session_name: string;
  translator_name: string;
  started_at: string;
  state: string;
  has_pin: boolean;
  listener_count: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export async function fetchActiveSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_BASE}/sessions?state=active`);
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  const data: SessionListResponse = await res.json();
  return data.items;
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Session not found');
    throw new Error(`Failed to fetch session: ${res.status}`);
  }
  const data = await res.json();
  return {
    id: data.id,
    session_name: data.session_name,
    translator_name: data.translator_name || 'Translator',
    started_at: data.started_at,
    state: data.state,
    has_pin: data.has_pin ?? !!data.pin,
    listener_count: data.listener_count ?? 0,
  };
}

export async function requestListenAccess(sessionId: string, pin?: string): Promise<ListenResponse> {
  const body: Record<string, string> = {};
  if (pin) body.pin = pin;

  const res = await fetch(`${API_BASE}/sessions/${sessionId}/listen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      error: { code: 'unknown', message: `HTTP ${res.status}` },
    }));
    throw new Error(err.error.message);
  }

  return res.json();
}
