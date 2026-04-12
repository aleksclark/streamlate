import { useState, useRef, useEffect, useCallback } from 'react';

export interface AudioAnalysis {
  rmsDb: number;
  peakDb: number;
  level: number; // 0-1 normalized
}

export function useAudioAnalyser(stream: MediaStream | null) {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({ rmsDb: -100, peakDb: -100, level: 0 });
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);

  const getGainNode = useCallback(() => gainNodeRef.current, []);

  useEffect(() => {
    if (!stream) {
      setAnalysis({ rmsDb: -100, peakDb: -100, level: 0 });
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    analyserRef.current = analyser;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;
    gainNodeRef.current = gainNode;

    source.connect(analyser);
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const dataArray = new Float32Array(analyser.fftSize);

    function tick() {
      analyser.getFloatTimeDomainData(dataArray);

      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i];
        sumSq += v * v;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      }

      const rms = Math.sqrt(sumSq / dataArray.length);
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;
      const level = Math.max(0, Math.min(1, (rmsDb + 60) / 60));

      setAnalysis({ rmsDb, peakDb, level });
      rafRef.current = requestAnimationFrame(tick);
    }

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      gainNode.disconnect();
      ctx.close();
      ctxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      gainNodeRef.current = null;
    };
  }, [stream]);

  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, []);

  return { ...analysis, setVolume, getGainNode, analyserRef };
}
