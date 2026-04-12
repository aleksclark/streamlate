import { useRef, useCallback } from 'react';

export function useWebRTC() {
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const connect = useCallback(async (_url: string) => {
    pcRef.current = new RTCPeerConnection();
    return pcRef.current;
  }, []);

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  return { connect, disconnect, pc: pcRef };
}
