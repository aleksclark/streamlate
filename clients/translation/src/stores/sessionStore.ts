import { create } from 'zustand';
import { api } from '../api';
import type { SessionResponse, SignalingMessage, SessionHealthResponse } from '../api';
import { useAuthStore } from './authStore';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

interface AudioState {
  sourceLevel: number;
  translationLevel: number;
  sourceVolume: number;
  translationVolume: number;
  isMuted: boolean;
  isPassthrough: boolean;
}

interface SessionState {
  session: SessionResponse | null;
  connectionState: ConnectionState;
  audio: AudioState;
  health: SessionHealthResponse | null;
  duration: number;
  error: string | null;

  ws: WebSocket | null;
  pc: RTCPeerConnection | null;
  sourceStream: MediaStream | null;
  localStream: MediaStream | null;
  sourceAnalyser: AnalyserNode | null;
  translationAnalyser: AnalyserNode | null;
  audioContext: AudioContext | null;
  gainNode: GainNode | null;

  createSession: (abcId: string, sessionName: string) => Promise<SessionResponse>;
  connectWebRTC: (session: SessionResponse) => Promise<void>;
  disconnect: () => void;
  stopSession: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setPassthrough: (enabled: boolean) => void;
  setSourceVolume: (volume: number) => void;
  setTranslationVolume: (volume: number) => void;
  pollHealth: () => Promise<void>;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

let _reconnectAttempts = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _pingTimer: ReturnType<typeof setInterval> | null = null;
let _healthTimer: ReturnType<typeof setInterval> | null = null;
let _durationTimer: ReturnType<typeof setInterval> | null = null;
let _vuAnimationId: number | null = null;

function clearTimers() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
  if (_durationTimer) { clearInterval(_durationTimer); _durationTimer = null; }
  if (_vuAnimationId) { cancelAnimationFrame(_vuAnimationId); _vuAnimationId = null; }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  connectionState: 'disconnected',
  audio: {
    sourceLevel: -60,
    translationLevel: -60,
    sourceVolume: 100,
    translationVolume: 100,
    isMuted: false,
    isPassthrough: false,
  },
  health: null,
  duration: 0,
  error: null,
  ws: null,
  pc: null,
  sourceStream: null,
  localStream: null,
  sourceAnalyser: null,
  translationAnalyser: null,
  audioContext: null,
  gainNode: null,

  createSession: async (abcId: string, sessionName: string) => {
    const session = await api.sessions.create({
      abc_id: abcId,
      session_name: sessionName,
    });
    set({ session, error: null });
    return session;
  },

  connectWebRTC: async (session: SessionResponse) => {
    const state = get();
    if (state.connectionState === 'connecting' || state.connectionState === 'connected') return;

    set({ connectionState: 'connecting', error: null, session });
    _reconnectAttempts = 0;

    try {
      const token = useAuthStore.getState().token;
      if (!token) throw new Error('Not authenticated');

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/translate/${session.id}?token=${token}`;

      await setupConnection(wsUrl);
    } catch (err) {
      set({ connectionState: 'failed', error: err instanceof Error ? err.message : 'Connection failed' });
    }
  },

  disconnect: () => {
    const { ws, pc, localStream, audioContext } = get();
    clearTimers();
    _reconnectAttempts = MAX_RECONNECT_ATTEMPTS;

    localStream?.getTracks().forEach((t) => t.stop());
    pc?.close();
    ws?.close();
    audioContext?.close().catch(() => {});

    set({
      connectionState: 'disconnected',
      ws: null,
      pc: null,
      localStream: null,
      sourceStream: null,
      sourceAnalyser: null,
      translationAnalyser: null,
      audioContext: null,
      gainNode: null,
      health: null,
      duration: 0,
    });
  },

  stopSession: async () => {
    const { session } = get();
    if (session) {
      try {
        await api.sessions.stop(session.id);
      } catch {
        // best effort
      }
    }
    get().disconnect();
    set({ session: null });
  },

  setMuted: (muted: boolean) => {
    const { ws, localStream } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'mute', muted }));
    }
    localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    set((s) => ({ audio: { ...s.audio, isMuted: muted } }));
  },

  setPassthrough: (enabled: boolean) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'passthrough', enabled }));
    }
    set((s) => ({ audio: { ...s.audio, isPassthrough: enabled } }));
  },

  setSourceVolume: (volume: number) => {
    set((s) => ({ audio: { ...s.audio, sourceVolume: volume } }));
    const { gainNode } = get();
    if (gainNode) {
      gainNode.gain.value = volume / 100;
    }
  },

  setTranslationVolume: (volume: number) => {
    set((s) => ({ audio: { ...s.audio, translationVolume: volume } }));
  },

  pollHealth: async () => {
    const { session } = get();
    if (!session) return;
    try {
      const health = await api.sessions.health(session.id);
      set({ health });
    } catch {
      // ignore
    }
  },
}));

async function setupConnection(wsUrl: string) {
  const set = useSessionStore.setState;
  const get = useSessionStore.getState;

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    },
  });

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const ws = new WebSocket(wsUrl);

  set({ ws, pc, localStream });

  localStream.getAudioTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const translationSource = audioCtx.createMediaStreamSource(localStream);
  const translationAnalyser = audioCtx.createAnalyser();
  translationAnalyser.fftSize = 256;
  translationAnalyser.smoothingTimeConstant = 0.8;
  translationSource.connect(translationAnalyser);

  set({ audioContext: audioCtx, translationAnalyser });

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    if (!remoteStream) return;
    set({ sourceStream: remoteStream });

    const sourceNode = audioCtx.createMediaStreamSource(remoteStream);
    const sourceAnalyser = audioCtx.createAnalyser();
    sourceAnalyser.fftSize = 256;
    sourceAnalyser.smoothingTimeConstant = 0.8;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = get().audio.sourceVolume / 100;

    sourceNode.connect(sourceAnalyser);
    sourceNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    set({ sourceAnalyser, gainNode });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ice-candidate',
        candidate: event.candidate.candidate,
        sdp_mid: event.candidate.sdpMid,
        sdp_m_line_index: event.candidate.sdpMLineIndex,
      }));
    }
  };

  pc.oniceconnectionstatechange = () => {
    const iceState = pc.iceConnectionState;
    if (iceState === 'connected' || iceState === 'completed') {
      set({ connectionState: 'connected' });
      _reconnectAttempts = 0;
    } else if (iceState === 'disconnected') {
      set({ connectionState: 'reconnecting' });
    } else if (iceState === 'failed') {
      attemptReconnect();
    }
  };

  ws.onopen = () => {
    _pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  };

  ws.onmessage = async (event) => {
    const msg: SignalingMessage = JSON.parse(event.data);

    switch (msg.type) {
      case 'welcome':
        await createAndSendOffer(pc, ws);
        break;

      case 'answer':
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        break;

      case 'ice-candidate':
        if (msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate({
            candidate: msg.candidate,
            sdpMid: msg.sdp_mid,
            sdpMLineIndex: msg.sdp_m_line_index,
          }));
        }
        break;

      case 'health':
        set({
          health: {
            session_id: get().session?.id ?? '',
            latency_ms: msg.latency_ms ?? 0,
            packet_loss: msg.packet_loss ?? 0,
            jitter_ms: msg.jitter_ms ?? 0,
            bitrate_kbps: msg.bitrate_kbps ?? 0,
          },
        });
        break;

      case 'session-stop':
        get().disconnect();
        break;

      case 'error':
        set({ error: msg.message });
        break;

      case 'pong':
        break;
    }
  };

  ws.onclose = () => {
    if (get().connectionState !== 'disconnected') {
      attemptReconnect();
    }
  };

  ws.onerror = () => {
    if (get().connectionState !== 'disconnected') {
      set({ connectionState: 'reconnecting' });
    }
  };

  startVuMeters();
  startDurationTimer();

  _healthTimer = setInterval(() => {
    get().pollHealth();
  }, 5000);
}

async function createAndSendOffer(pc: RTCPeerConnection, ws: WebSocket) {
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: false,
  });
  await pc.setLocalDescription(offer);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
  }
}

function attemptReconnect() {
  const get = useSessionStore.getState;
  const set = useSessionStore.setState;

  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    set({ connectionState: 'failed', error: 'Connection lost after multiple retries' });
    return;
  }

  set({ connectionState: 'reconnecting' });
  _reconnectAttempts++;

  const delay = RECONNECT_BASE_DELAY * Math.pow(2, _reconnectAttempts - 1);
  _reconnectTimer = setTimeout(async () => {
    const { session } = get();
    if (!session) return;

    const { localStream, pc, ws, audioContext } = get();
    localStream?.getTracks().forEach((t) => t.stop());
    pc?.close();
    ws?.close();
    audioContext?.close().catch(() => {});

    try {
      const token = useAuthStore.getState().token;
      if (!token) throw new Error('Not authenticated');

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/translate/${session.id}?token=${token}`;
      await setupConnection(wsUrl);
    } catch {
      attemptReconnect();
    }
  }, delay);
}

function startVuMeters() {
  const get = useSessionStore.getState;
  const set = useSessionStore.setState;

  function update() {
    const { sourceAnalyser, translationAnalyser } = get();

    let sourceLevel = -60;
    let translationLevel = -60;

    if (sourceAnalyser) {
      const data = new Float32Array(sourceAnalyser.frequencyBinCount);
      sourceAnalyser.getFloatTimeDomainData(data);
      sourceLevel = rmsToDb(computeRms(data));
    }

    if (translationAnalyser) {
      const data = new Float32Array(translationAnalyser.frequencyBinCount);
      translationAnalyser.getFloatTimeDomainData(data);
      translationLevel = rmsToDb(computeRms(data));
    }

    set((s) => ({
      audio: { ...s.audio, sourceLevel, translationLevel },
    }));

    _vuAnimationId = requestAnimationFrame(update);
  }

  _vuAnimationId = requestAnimationFrame(update);
}

function startDurationTimer() {
  const set = useSessionStore.setState;
  _durationTimer = setInterval(() => {
    set((s) => ({ duration: s.duration + 1 }));
  }, 1000);
}

function computeRms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

function rmsToDb(rms: number): number {
  if (rms < 0.00001) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(rms)));
}
