import { useState, useRef, useCallback, useEffect } from 'react';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ListenerWebRTCState {
  connectionState: ConnectionState;
  audioStream: MediaStream | null;
  error: string | null;
}

export interface UseListenerWebRTC extends ListenerWebRTCState {
  connect: (signalingUrl: string) => void;
  disconnect: () => void;
}

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;

export function useListenerWebRTC(): UseListenerWebRTC {
  const [state, setState] = useState<ListenerWebRTCState>({
    connectionState: 'idle',
    audioStream: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalingUrlRef = useRef<string>('');
  const disconnectedRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptConnectRef = useRef<(url: string) => void>(() => {});

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (disconnectedRef.current) return;
    if (retryCountRef.current >= MAX_RETRIES) {
      setState(prev => ({
        ...prev,
        connectionState: 'disconnected',
        error: 'Connection lost. Max retries exceeded.',
      }));
      return;
    }
    retryCountRef.current++;
    const backoff = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, retryCountRef.current - 1),
      MAX_BACKOFF_MS
    );
    setState(prev => ({ ...prev, connectionState: 'reconnecting' }));
    retryTimerRef.current = setTimeout(() => {
      attemptConnectRef.current(signalingUrlRef.current);
    }, backoff);
  }, []);

  const attemptConnect = useCallback((url: string) => {
    cleanup();
    setState(prev => ({
      ...prev,
      connectionState: retryCountRef.current > 0 ? 'reconnecting' : 'connecting',
      error: null,
    }));

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'welcome') {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          pcRef.current = pc;

          pc.addTransceiver('audio', { direction: 'recvonly' });

          pc.ontrack = (trackEvent) => {
            const stream = trackEvent.streams[0] || new MediaStream([trackEvent.track]);
            setState(prev => ({ ...prev, audioStream: stream, connectionState: 'connected' }));
            retryCountRef.current = 0;
          };

          pc.onicecandidate = (iceEvent) => {
            if (iceEvent.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ice-candidate', candidate: iceEvent.candidate }));
            }
          };

          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
              if (!disconnectedRef.current) {
                scheduleRetry();
              }
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
        } else if (data.type === 'answer') {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription({ type: 'answer', sdp: data.sdp })
            );
          }
        } else if (data.type === 'ice-candidate' && data.candidate) {
          if (pcRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } else if (data.type === 'session-stop') {
          cleanup();
          setState({
            connectionState: 'disconnected',
            audioStream: null,
            error: 'session-ended',
          });
        } else if (data.type === 'error') {
          setState(prev => ({ ...prev, error: data.message }));
        }
      } catch (e) {
        console.error('Signaling message error:', e);
      }
    };

    ws.onclose = (closeEvent) => {
      if (!disconnectedRef.current && closeEvent.code !== 1000) {
        scheduleRetry();
      }
    };

    ws.onerror = () => {};
  }, [cleanup, scheduleRetry]);

  attemptConnectRef.current = attemptConnect;

  const connect = useCallback((signalingUrl: string) => {
    disconnectedRef.current = false;
    retryCountRef.current = 0;
    signalingUrlRef.current = signalingUrl;
    attemptConnect(signalingUrl);
  }, [attemptConnect]);

  const disconnect = useCallback(() => {
    disconnectedRef.current = true;
    retryCountRef.current = 0;
    cleanup();
    setState({ connectionState: 'idle', audioStream: null, error: null });
  }, [cleanup]);

  useEffect(() => {
    return () => {
      disconnectedRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return {
    ...state,
    connect,
    disconnect,
  };
}
