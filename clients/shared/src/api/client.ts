export interface LoginResponse {
  access_token: string;
  expires_in: number;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

export interface AbcResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface AbcsListResponse {
  items: AbcResponse[];
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

export interface SessionsListResponse {
  items: SessionResponse[];
}

export interface SessionHealthResponse {
  session_id: string;
  latency_ms: number;
  packet_loss: number;
  jitter_ms: number;
  bitrate_kbps: number;
}

export interface AbcStatus {
  abc_id: string;
  online: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

type TokenGetter = () => string | null;
type TokenRefresher = () => Promise<string | null>;
type OnAuthFailure = () => void;

export interface ApiClientConfig {
  baseUrl: string;
  getToken: TokenGetter;
  refreshToken: TokenRefresher;
  onAuthFailure: OnAuthFailure;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    skipAuth = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (!skipAuth) {
      const token = this.config.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    let res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });

    if (res.status === 401 && !skipAuth) {
      const newToken = await this.config.refreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(`${this.config.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
        });
      } else {
        this.config.onAuthFailure();
        throw new ApiRequestError(401, 'unauthorized', 'Session expired');
      }
    }

    if (!res.ok) {
      let errorBody: ApiError | undefined;
      try {
        errorBody = await res.json() as ApiError;
      } catch {
        // ignore parse errors
      }
      throw new ApiRequestError(
        res.status,
        errorBody?.error?.code ?? 'unknown',
        errorBody?.error?.message ?? res.statusText
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('POST', '/api/v1/auth/login', { email, password }, true);
  }

  async refresh(): Promise<RefreshResponse> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!res.ok) {
      throw new ApiRequestError(res.status, 'unauthorized', 'Refresh failed');
    }

    return res.json() as Promise<RefreshResponse>;
  }

  async logout(): Promise<void> {
    await fetch(`${this.config.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  async me(): Promise<UserInfo> {
    return this.request<UserInfo>('GET', '/api/v1/auth/me');
  }

  async listAbcs(): Promise<AbcsListResponse> {
    return this.request<AbcsListResponse>('GET', '/api/v1/abcs');
  }

  async getAbcStatus(abcId: string): Promise<AbcStatus> {
    return this.request<AbcStatus>('GET', `/api/v1/abcs/${abcId}/status`);
  }

  async listSessions(state?: string): Promise<SessionsListResponse> {
    const query = state ? `?state=${encodeURIComponent(state)}` : '';
    return this.request<SessionsListResponse>('GET', `/api/v1/sessions${query}`);
  }

  async createSession(
    abcId: string,
    sessionName: string,
    pin?: string
  ): Promise<SessionResponse> {
    return this.request<SessionResponse>('POST', '/api/v1/sessions', {
      abc_id: abcId,
      session_name: sessionName,
      pin,
    });
  }

  async stopSession(sessionId: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('POST', `/api/v1/sessions/${sessionId}/stop`);
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('GET', `/api/v1/sessions/${sessionId}`);
  }

  async getSessionHealth(sessionId: string): Promise<SessionHealthResponse> {
    return this.request<SessionHealthResponse>('GET', `/api/v1/sessions/${sessionId}/health`);
  }

  async systemHealth(): Promise<{ status: string; version: string }> {
    return this.request('GET', '/api/v1/system/health', undefined, true);
  }
}

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}
