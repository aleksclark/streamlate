export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'translator';
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

export interface MeResponse {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export interface AbcResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface AbcListResponse {
  items: AbcResponse[];
}

export interface AbcStatus {
  abc_id: string;
  online: boolean;
}

export interface CreateSessionRequest {
  abc_id: string;
  session_name: string;
  pin?: string;
}

export interface SessionResponse {
  id: string;
  abc_id: string;
  translator_id: string;
  session_name: string;
  state: 'starting' | 'active' | 'completed' | 'failed' | 'paused' | 'passthrough';
  signaling_url?: string;
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

export interface SessionListResponse {
  items: SessionResponse[];
}

export interface SessionHealthResponse {
  session_id: string;
  latency_ms: number;
  packet_loss: number;
  jitter_ms: number;
  bitrate_kbps: number;
}

export interface HealthResponse {
  status: string;
  version: string;
}

export interface RecordingResponse {
  id: string;
  session_id: string;
  session_name: string;
  duration_seconds: number | null;
  size_bytes: number | null;
  state: 'recording' | 'completed' | 'failed';
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface RecordingsListResponse {
  items: RecordingResponse[];
}

export interface RecordingEvent {
  time: number;
  type: string;
  value?: unknown;
}

export interface RecordingMetadataResponse {
  id: string;
  session_id: string;
  session_name: string;
  translator_name: string;
  abc_name: string;
  duration_seconds: number | null;
  size_bytes: number | null;
  state: string;
  started_at: string;
  ended_at: string | null;
  events: RecordingEvent[];
}

export interface StorageStatsResponse {
  total_recordings: number;
  total_size_bytes: number;
  recording_path: string;
}

export interface BulkDeleteResponse {
  deleted: number;
  requested: number;
}

export type SignalingMessage =
  | { type: 'welcome'; session_id: string }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice-candidate'; candidate: string; sdp_mid?: string; sdp_m_line_index?: number }
  | { type: 'ice-restart' }
  | { type: 'session-start'; session_id: string; session_name: string }
  | { type: 'session-stop'; session_id: string }
  | { type: 'mute'; muted: boolean }
  | { type: 'passthrough'; enabled: boolean }
  | { type: 'health'; latency: number; loss: number; jitter: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'ping' }
  | { type: 'pong' };
