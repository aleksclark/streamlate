import type {
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  MeResponse,
  AbcListResponse,
  AbcStatus,
  CreateSessionRequest,
  SessionResponse,
  SessionListResponse,
  SessionHealthResponse,
  HealthResponse,
  RecordingsListResponse,
  RecordingMetadataResponse,
  StorageStatsResponse,
  BulkDeleteResponse,
  ApiError,
  UserResponse,
  UsersListResponse,
  CreateUserRequest,
  UpdateUserRequest,
  AbcCredentialsResponse,
  CreateAbcRequest,
  UpdateAbcRequest,
  RotateSecretResponse,
  SystemStatsResponse,
  RecordingsListResponse,
  RecordingResponse,
} from './types';

const API_BASE = '/api/v1';

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type TokenProvider = () => string | null;
type TokenRefresher = () => Promise<string | null>;
type OnUnauthorized = () => void;

let _getToken: TokenProvider = () => null;
let _refreshToken: TokenRefresher = async () => null;
let _onUnauthorized: OnUnauthorized = () => {};
let _isRefreshing = false;
let _refreshPromise: Promise<string | null> | null = null;

export function configureApiClient(opts: {
  getToken: TokenProvider;
  refreshToken: TokenRefresher;
  onUnauthorized: OnUnauthorized;
}) {
  _getToken = opts.getToken;
  _refreshToken = opts.refreshToken;
  _onUnauthorized = opts.onUnauthorized;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let apiErr: ApiError | null = null;
    try {
      apiErr = await res.json() as ApiError;
    } catch {
      // ignore parse errors
    }
    throw new ApiClientError(
      res.status,
      apiErr?.error?.code ?? 'unknown',
      apiErr?.error?.message ?? `HTTP ${res.status}`,
      apiErr?.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function fetchWithAuth<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = _getToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry) {
    const newToken = await doRefresh();
    if (newToken) {
      return fetchWithAuth<T>(path, init, false);
    }
    _onUnauthorized();
    throw new ApiClientError(401, 'unauthorized', 'Session expired');
  }

  return handleResponse<T>(res);
}

async function doRefresh(): Promise<string | null> {
  if (_isRefreshing && _refreshPromise) {
    return _refreshPromise;
  }
  _isRefreshing = true;
  _refreshPromise = _refreshToken();
  try {
    const token = await _refreshPromise;
    return token;
  } finally {
    _isRefreshing = false;
    _refreshPromise = null;
  }
}

export const api = {
  auth: {
    async login(data: LoginRequest): Promise<LoginResponse> {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      return handleResponse<LoginResponse>(res);
    },

    async refresh(): Promise<RefreshResponse> {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return handleResponse<RefreshResponse>(res);
    },

    async logout(): Promise<void> {
      const token = _getToken();
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      }).catch(() => {});
    },

    me(): Promise<MeResponse> {
      return fetchWithAuth<MeResponse>('/auth/me');
    },
  },

  abcs: {
    list(): Promise<AbcListResponse> {
      return fetchWithAuth<AbcListResponse>('/abcs');
    },

    create(data: CreateAbcRequest): Promise<AbcCredentialsResponse> {
      return fetchWithAuth<AbcCredentialsResponse>('/abcs', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get(abcId: string): Promise<AbcListResponse['items'][0]> {
      return fetchWithAuth('/abcs/' + abcId);
    },

    update(abcId: string, data: UpdateAbcRequest): Promise<AbcListResponse['items'][0]> {
      return fetchWithAuth('/abcs/' + abcId, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    delete(abcId: string): Promise<void> {
      return fetchWithAuth('/abcs/' + abcId, { method: 'DELETE' });
    },

    rotateSecret(abcId: string): Promise<RotateSecretResponse> {
      return fetchWithAuth<RotateSecretResponse>('/abcs/' + abcId + '/rotate-secret', {
        method: 'POST',
      });
    },

    async status(abcId: string): Promise<AbcStatus> {
      const res = await fetch(`${API_BASE}/abcs/${abcId}/status`);
      return handleResponse<AbcStatus>(res);
    },
  },

  sessions: {
    list(state?: string): Promise<SessionListResponse> {
      const qs = state ? `?state=${state}` : '';
      return fetchWithAuth<SessionListResponse>(`/sessions${qs}`);
    },

    create(data: CreateSessionRequest): Promise<SessionResponse> {
      return fetchWithAuth<SessionResponse>('/sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get(id: string): Promise<SessionResponse> {
      return fetchWithAuth<SessionResponse>(`/sessions/${id}`);
    },

    stop(id: string): Promise<SessionResponse> {
      return fetchWithAuth<SessionResponse>(`/sessions/${id}/stop`, {
        method: 'POST',
      });
    },

    health(id: string): Promise<SessionHealthResponse> {
      return fetchWithAuth<SessionHealthResponse>(`/sessions/${id}/health`);
    },
  },

  system: {
    async health(): Promise<HealthResponse> {
      const res = await fetch(`${API_BASE}/system/health`);
      return handleResponse<HealthResponse>(res);
    },

    stats(): Promise<SystemStatsResponse> {
      return fetchWithAuth<SystemStatsResponse>('/system/stats');
    },
  },

  users: {
    list(): Promise<UsersListResponse> {
      return fetchWithAuth<UsersListResponse>('/users');
    },

    create(data: CreateUserRequest): Promise<UserResponse> {
      return fetchWithAuth<UserResponse>('/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get(id: string): Promise<UserResponse> {
      return fetchWithAuth<UserResponse>('/users/' + id);
    },

    update(id: string, data: UpdateUserRequest): Promise<UserResponse> {
      return fetchWithAuth<UserResponse>('/users/' + id, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    delete(id: string): Promise<void> {
      return fetchWithAuth('/users/' + id, { method: 'DELETE' });
    },
  },

  recordings: {
    list(): Promise<RecordingsListResponse> {
      return fetchWithAuth<RecordingsListResponse>('/recordings');
    },

    get(id: string): Promise<RecordingResponse> {
      return fetchWithAuth<RecordingResponse>('/recordings/' + id);
    },

    delete(id: string): Promise<void> {
      return fetchWithAuth('/recordings/' + id, { method: 'DELETE' });
    },
  },

  recordings: {
    list(params?: { session_id?: string; limit?: number; offset?: number }): Promise<RecordingsListResponse> {
      const qs = new URLSearchParams();
      if (params?.session_id) qs.set('session_id', params.session_id);
      if (params?.limit) qs.set('limit', params.limit.toString());
      if (params?.offset) qs.set('offset', params.offset.toString());
      const query = qs.toString();
      return fetchWithAuth<RecordingsListResponse>(`/recordings${query ? `?${query}` : ''}`);
    },

    get(id: string): Promise<RecordingMetadataResponse> {
      return fetchWithAuth<RecordingMetadataResponse>(`/recordings/${id}`);
    },

    sourceUrl(id: string): string {
      return `${API_BASE}/recordings/${id}/source`;
    },

    translationUrl(id: string): string {
      return `${API_BASE}/recordings/${id}/translation`;
    },

    delete(id: string): Promise<void> {
      return fetchWithAuth<void>(`/recordings/${id}`, { method: 'DELETE' });
    },

    bulkDelete(ids: string[]): Promise<BulkDeleteResponse> {
      return fetchWithAuth<BulkDeleteResponse>('/recordings/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
    },

    storageStats(): Promise<StorageStatsResponse> {
      return fetchWithAuth<StorageStatsResponse>('/system/storage');
    },
  },
};
