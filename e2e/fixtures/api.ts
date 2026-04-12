const API_BASE = 'http://localhost:8080/api/v1';

export class StreamlateAPI {
  constructor(private baseUrl: string = API_BASE) {}

  async health(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/system/health`);
    return res.json();
  }

  async waitReady(timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const h = await this.health();
        if (h.status === 'ok') return;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server did not become ready');
  }

  async login(email: string, password: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json();
    return data.access_token;
  }

  async createSession(
    token: string,
    opts: { session_name: string; pin?: string; translator_name?: string }
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
    return res.json();
  }

  async stopSession(token: string, sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Stop session failed: ${res.status}`);
  }

  async getSessions(state?: string): Promise<Record<string, unknown>[]> {
    const url = state
      ? `${this.baseUrl}/sessions?state=${state}`
      : `${this.baseUrl}/sessions`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Get sessions failed: ${res.status}`);
    const data = await res.json();
    return data.items;
  }

  async getSession(sessionId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`Get session failed: ${res.status}`);
    return res.json();
  }

  async requestListen(
    sessionId: string,
    pin?: string
  ): Promise<{ signaling_url: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/listen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pin ? { pin } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }
}
