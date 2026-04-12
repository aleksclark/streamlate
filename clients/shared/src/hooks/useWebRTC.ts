import { useRef, useCallback, useState, useEffect } from 'react';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SignalingMessage {
  type: string;
  sdp?: string;
  candidate?: string;
  sdp_mid?: string | null;
  sdp_m_line_index?: number | null;
  session_id?: string;
  abc_id?: string;
  muted?: boolean;
  enabled?: boolean;
  latency_ms?: number;
  packet_loss?: number;
  jitter_ms?: number;
  bitrate_kbps?: number;
  code?: string;
  message?: string;
}

export interface ChannelHealth {
  latencyMs: number;
  packetLoss: number;
  jitterMs: number;
  bitrateKbps: number;
}

export interface UseWebRTCReturn {
  connectionState: ConnectionState;
  sourceStream: MediaStream | null;
  translationStream: MediaStream | null;
  channelHealth: ChannelHealth | null;
  connect: (wsUrl: string) => Promise<void>;
  disconnect: () => void;
  setMuted: (muted: boolean) => void;
  setPassthrough: (enabled: boolean) => void;
  isMuted: boolean;
  isPassthrough: boolean;
}

export function useWebRTC(): UseWebRTCReturn {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [translationStream, setTranslationStream] = useState<MediaStream | null>(null);
  const [channelHealth, setChannelHealth] = useState<ChannelHealth | null>(null);
  const [isMuted, setIsMutedState] = useState(false);
  const [isPassthrough, setIsPassthroughState] = useState(false);

  const sendSignaling = useCallback((msg: SignalingMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    setSourceStream(null);
    setTranslationStream(null);
    setChannelHealth(null);
  }, []);

  const connect = useCallback(async (wsUrl: string) => {
    cleanup();
    setConnectionState('connecting');

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;
      setTranslationStream(micStream);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 15000);
      });

      ws.onmessage = (event) => {
        const msg: SignalingMessage = JSON.parse(event.data);
        handleSignalingMessage(msg);
      };

      ws.onclose = () => {
        if (connectionState !== 'disconnected') {
          setConnectionState('disconnected');
        }
      };

    } catch (err) {
      setConnectionState('error');
      cleanup();
      throw err;
    }

    function handleSignalingMessage(msg: SignalingMessage) {
      switch (msg.type) {
        case 'welcome':
          createPeerConnection();
          break;
        case 'answer':
          handleAnswer(msg);
          break;
        case 'ice-candidate':
          handleRemoteIceCandidate(msg);
          break;
        case 'health':
          setChannelHealth({
            latencyMs: msg.latency_ms ?? 0,
            packetLoss: msg.packet_loss ?? 0,
            jitterMs: msg.jitter_ms ?? 0,
            bitrateKbps: msg.bitrate_kbps ?? 0,
          });
          break;
        case 'error':
          console.error('Server signaling error:', msg.code, msg.message);
          setConnectionState('error');
          break;
        case 'ping':
          sendSignaling({ type: 'pong' });
          break;
        case 'pong':
          break;
      }
    }

    async function createPeerConnection() {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      const mic = micStreamRef.current;
      if (mic) {
        mic.getAudioTracks().forEach((track) => {
          pc.addTrack(track, mic);
        });
      }

      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        const remoteStream = new MediaStream();
        remoteStream.addTrack(event.track);
        setSourceStream(remoteStream);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignaling({
            type: 'ice-candidate',
            candidate: event.candidate.candidate,
            sdp_mid: event.candidate.sdpMid,
            sdp_m_line_index: event.candidate.sdpMLineIndex,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        switch (pc.connectionState) {
          case 'connected':
            setConnectionState('connected');
            break;
          case 'disconnected':
            setConnectionState('reconnecting');
            break;
          case 'failed':
            setConnectionState('error');
            break;
          case 'closed':
            setConnectionState('disconnected');
            break;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignaling({
        type: 'offer',
        sdp: offer.sdp!,
      });
    }

    async function handleAnswer(msg: SignalingMessage) {
      const pc = pcRef.current;
      if (pc && msg.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: msg.sdp,
        }));
      }
    }

    async function handleRemoteIceCandidate(msg: SignalingMessage) {
      const pc = pcRef.current;
      if (pc && msg.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate({
          candidate: msg.candidate,
          sdpMid: msg.sdp_mid ?? undefined,
          sdpMLineIndex: msg.sdp_m_line_index ?? undefined,
        }));
      }
    }
  }, [cleanup, sendSignaling, connectionState]);

  const disconnect = useCallback(() => {
    setConnectionState('disconnected');
    cleanup();
  }, [cleanup]);

  const setMuted = useCallback((muted: boolean) => {
    setIsMutedState(muted);
    sendSignaling({ type: 'mute', muted });
  }, [sendSignaling]);

  const setPassthrough = useCallback((enabled: boolean) => {
    setIsPassthroughState(enabled);
    sendSignaling({ type: 'passthrough', enabled });
  }, [sendSignaling]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    connectionState,
    sourceStream,
    translationStream,
    channelHealth,
    connect,
    disconnect,
    setMuted,
    setPassthrough,
    isMuted,
    isPassthrough,
  };
}
