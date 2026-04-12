import { useRef, useEffect, useState, useCallback } from 'react';

export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(-60);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(-60);
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    source.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);

    function measure() {
      if (!analyserRef.current) return;
      analyserRef.current.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      setLevel(Math.max(-60, Math.min(0, db)));
      rafRef.current = requestAnimationFrame(measure);
    }

    rafRef.current = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      analyser.disconnect();
      ctx.close();
      ctxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [stream]);

  return level;
}

export function useGainNode(
  stream: MediaStream | null,
  gainValue: number
): MediaStream | null {
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setOutputStream(null);
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = gainValue / 100;

    const dest = ctx.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(dest);

    setOutputStream(dest.stream);

    return () => {
      source.disconnect();
      gain.disconnect();
      dest.disconnect();
      ctx.close();
      ctxRef.current = null;
    };
  }, [stream, gainValue]);

  return outputStream;
}
