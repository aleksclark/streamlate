const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  user: { id: string; email: string; display_name: string; role: string };
}

export interface UserResponse {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface AbcCredentialsResponse {
  id: string;
  name: string;
  secret: string;
  created_at: string;
}

export interface AbcResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SessionResponse {
  id: string;
  abc_id: string;
  translator_id: string;
  session_name: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export class StreamlateAPI {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      token?: string;
      cookie?: string;
      expectStatus?: number;
    } = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });

    if (options.expectStatus !== undefined && res.status !== options.expectStatus) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(
        `Expected ${options.expectStatus} but got ${res.status} for ${method} ${path}: ${text}`
      );
    }

    return res;
  }

  async health(): Promise<{ status: string; version: string }> {
    const res = await this.request('GET', '/api/v1/system/health');
    return res.json() as Promise<{ status: string; version: string }>;
  }

  async waitReady(timeoutMs: number = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.health();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`Server not ready after ${timeoutMs}ms`);
  }

  async login(
    email: string,
    password: string
  ): Promise<{ data: LoginResponse; refreshCookie: string | null; status: number }> {
    const res = await this.request('POST', '/api/v1/auth/login', {
      body: { email, password },
    });
    const status = res.status;
    const data = (await res.json()) as LoginResponse;
    const setCookie = res.headers.get('set-cookie');
    return { data, refreshCookie: setCookie, status };
  }

  async loginRaw(
    email: string,
    password: string
  ): Promise<Response> {
    return this.request('POST', '/api/v1/auth/login', {
      body: { email, password },
    });
  }

  async refresh(
    refreshCookie: string
  ): Promise<{ data: { access_token: string; expires_in: number }; newCookie: string | null; status: number }> {
    const res = await this.request('POST', '/api/v1/auth/refresh', {
      cookie: refreshCookie,
    });
    const status = res.status;
    const data = await res.json();
    const setCookie = res.headers.get('set-cookie');
    return { data, newCookie: setCookie, status };
  }

  async refreshRaw(refreshCookie: string): Promise<Response> {
    return this.request('POST', '/api/v1/auth/refresh', {
      cookie: refreshCookie,
    });
  }

  async logout(refreshCookie: string): Promise<Response> {
    return this.request('POST', '/api/v1/auth/logout', {
      cookie: refreshCookie,
    });
  }

  async me(token: string): Promise<Response> {
    return this.request('GET', '/api/v1/auth/me', { token });
  }

  async meRaw(token?: string): Promise<Response> {
    return this.request('GET', '/api/v1/auth/me', { token });
  }

  async createUser(
    token: string,
    user: { email: string; password: string; display_name: string; role: string }
  ): Promise<{ data: UserResponse; status: number }> {
    const res = await this.request('POST', '/api/v1/users', {
      token,
      body: user,
    });
    const status = res.status;
    const data = (await res.json()) as UserResponse;
    return { data, status };
  }

  async createUserRaw(
    token: string,
    user: { email: string; password: string; display_name: string; role: string }
  ): Promise<Response> {
    return this.request('POST', '/api/v1/users', {
      token,
      body: user,
    });
  }

  async getUser(token: string, id: string): Promise<Response> {
    return this.request('GET', `/api/v1/users/${id}`, { token });
  }

  async listUsers(token: string): Promise<{ items: UserResponse[] }> {
    const res = await this.request('GET', '/api/v1/users', { token });
    return res.json();
  }

  async deleteUser(token: string, id: string): Promise<Response> {
    return this.request('DELETE', `/api/v1/users/${id}`, { token });
  }

  async createAbc(
    token: string,
    name: string
  ): Promise<{ data: AbcCredentialsResponse; status: number }> {
    const res = await this.request('POST', '/api/v1/abcs', {
      token,
      body: { name },
    });
    const status = res.status;
    const data = (await res.json()) as AbcCredentialsResponse;
    return { data, status };
  }

  async getAbc(token: string, id: string): Promise<Response> {
    return this.request('GET', `/api/v1/abcs/${id}`, { token });
  }

  async abcRegister(
    abcId: string,
    abcSecret: string
  ): Promise<Response> {
    return this.request('POST', '/api/v1/abc/register', {
      body: { abc_id: abcId, abc_secret: abcSecret },
    });
  }

  async createSession(
    token: string,
    abcId: string,
    sessionName: string,
    pin?: string
  ): Promise<{ data: SessionResponse; status: number }> {
    const res = await this.request('POST', '/api/v1/sessions', {
      token,
      body: { abc_id: abcId, session_name: sessionName, pin },
    });
    const status = res.status;
    const data = (await res.json()) as SessionResponse;
    return { data, status };
  }

  async createSessionRaw(
    token: string,
    abcId: string,
    sessionName: string
  ): Promise<Response> {
    return this.request('POST', '/api/v1/sessions', {
      token,
      body: { abc_id: abcId, session_name: sessionName },
    });
  }

  async stopSession(token: string, sessionId: string): Promise<Response> {
    return this.request('POST', `/api/v1/sessions/${sessionId}/stop`, {
      token,
    });
  }

  async getSession(token: string, sessionId: string): Promise<Response> {
    return this.request('GET', `/api/v1/sessions/${sessionId}`, { token });
  }

  async openapi(): Promise<Response> {
    return this.request('GET', '/api/openapi.json');
  }

  async getAbcStatus(abcId: string): Promise<{ abc_id: string; online: boolean }> {
    const res = await this.request('GET', `/api/v1/abcs/${abcId}/status`);
    return res.json();
  }

  async getSessionHealth(
    token: string,
    sessionId: string
  ): Promise<{
    session_id: string;
    latency_ms: number;
    packet_loss: number;
    jitter_ms: number;
    bitrate_kbps: number;
  }> {
    const res = await this.request('GET', `/api/v1/sessions/${sessionId}/health`, {
      token,
    });
    return res.json();
  }

  async getSessionHealthRaw(token: string, sessionId: string): Promise<Response> {
    return this.request('GET', `/api/v1/sessions/${sessionId}/health`, {
      token,
    });
  }
}
