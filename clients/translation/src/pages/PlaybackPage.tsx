import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecordingsStore } from '../stores/recordingsStore';
import { useThemeStore } from '../stores/themeStore';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api';
import type { RecordingEvent } from '../api';

const SPEED_OPTIONS = [0.5, 1, 1.5, 2];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlaybackPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);

  const { currentRecording, currentLoading, fetchRecording, deleteRecording } = useRecordingsStore();
  const isAdmin = useAuthStore((s) => s.user)?.role === 'admin';
  const isDark = theme === 'dark';

  const sourceRef = useRef<HTMLAudioElement>(null);
  const translationRef = useRef<HTMLAudioElement>(null);
  const animFrameRef = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sourceVolume, setSourceVolume] = useState(0.8);
  const [translationVolume, setTranslationVolume] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [translationLoaded, setTranslationLoaded] = useState(false);

  useEffect(() => {
    if (id) fetchRecording(id);
  }, [id, fetchRecording]);

  useEffect(() => {
    if (sourceRef.current) sourceRef.current.volume = sourceVolume;
  }, [sourceVolume]);

  useEffect(() => {
    if (translationRef.current) translationRef.current.volume = translationVolume;
  }, [translationVolume]);

  useEffect(() => {
    if (sourceRef.current) sourceRef.current.playbackRate = speed;
    if (translationRef.current) translationRef.current.playbackRate = speed;
  }, [speed]);

  const updateTime = useCallback(() => {
    if (sourceRef.current) {
      setCurrentTime(sourceRef.current.currentTime);
    }
    animFrameRef.current = requestAnimationFrame(updateTime);
  }, []);

  useEffect(() => {
    if (playing) {
      animFrameRef.current = requestAnimationFrame(updateTime);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playing, updateTime]);

  const handlePlay = () => {
    if (!sourceRef.current || !translationRef.current) return;
    if (playing) {
      sourceRef.current.pause();
      translationRef.current.pause();
      setPlaying(false);
    } else {
      sourceRef.current.play();
      translationRef.current.play();
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (sourceRef.current) sourceRef.current.currentTime = time;
    if (translationRef.current) translationRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleSourceLoaded = () => {
    setSourceLoaded(true);
    if (sourceRef.current && sourceRef.current.duration > duration) {
      setDuration(sourceRef.current.duration);
    }
  };

  const handleTranslationLoaded = () => {
    setTranslationLoaded(true);
    if (translationRef.current && translationRef.current.duration > duration) {
      setDuration(translationRef.current.duration);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
    setCurrentTime(0);
    if (sourceRef.current) sourceRef.current.currentTime = 0;
    if (translationRef.current) translationRef.current.currentTime = 0;
  };

  const handleDelete = async () => {
    if (!id) return;
    await deleteRecording(id);
    navigate('/recordings');
  };

  const sourceUrl = id ? `${api.recordings.sourceUrl(id)}` : '';
  const translationUrl = id ? `${api.recordings.translationUrl(id)}` : '';

  const events = currentRecording?.events ?? [];
  const ready = sourceLoaded && translationLoaded;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" data-testid="playback-page">
      <button
        onClick={() => navigate('/recordings')}
        className={`mb-4 text-sm flex items-center gap-1 ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to recordings
      </button>

      {currentLoading && (
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${
            isDark ? 'border-blue-400' : 'border-blue-600'
          }`} />
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Loading...
          </span>
        </div>
      )}

      {currentRecording && (
        <>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {currentRecording.session_name}
              </h1>
              <div className={`text-sm mt-1 flex items-center gap-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {currentRecording.translator_name && (
                  <span>Translator: {currentRecording.translator_name}</span>
                )}
                {currentRecording.abc_name && (
                  <span>Booth: {currentRecording.abc_name}</span>
                )}
                <span>{currentRecording.started_at ? new Date(currentRecording.started_at).toLocaleString() : ''}</span>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={handleDelete}
                data-testid="delete-recording-btn"
                className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {/* Hidden audio elements with authenticated URLs */}
          <audio
            ref={sourceRef}
            data-testid="source-audio"
            onLoadedMetadata={handleSourceLoaded}
            onEnded={handleEnded}
            preload="auto"
          >
            {sourceUrl && <source src={sourceUrl} type="audio/ogg" />}
          </audio>
          <audio
            ref={translationRef}
            data-testid="translation-audio"
            onLoadedMetadata={handleTranslationLoaded}
            preload="auto"
          >
            {translationUrl && <source src={translationUrl} type="audio/ogg" />}
          </audio>

          {/* Player controls */}
          <div className={`rounded-xl p-6 ${isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'}`}>
            {/* Timeline with event markers */}
            <div className="mb-4" data-testid="timeline">
              <div className="relative">
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  disabled={!ready}
                  data-testid="seek-slider"
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  style={{
                    background: duration
                      ? `linear-gradient(to right, ${isDark ? '#3b82f6' : '#2563eb'} ${(currentTime / duration) * 100}%, ${isDark ? '#374151' : '#e5e7eb'} ${(currentTime / duration) * 100}%)`
                      : isDark ? '#374151' : '#e5e7eb',
                  }}
                />
                {/* Event markers */}
                {duration > 0 && events.map((evt, i) => (
                  <EventMarker
                    key={i}
                    event={evt}
                    duration={duration}
                    isDark={isDark}
                  />
                ))}
              </div>
              <div className={`flex justify-between text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <span data-testid="current-time">{formatTime(currentTime)}</span>
                <span data-testid="total-duration">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-6">
              {/* Play/Pause */}
              <button
                onClick={handlePlay}
                disabled={!ready}
                data-testid="play-pause-btn"
                className={`w-12 h-12 flex items-center justify-center rounded-full transition-colors ${
                  isDark
                    ? 'bg-blue-600 hover:bg-blue-500 text-white disabled:bg-gray-700'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300'
                }`}
              >
                {playing ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Speed control */}
              <div className="flex items-center gap-2" data-testid="speed-controls">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    data-testid={`speed-${s}x`}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      speed === s
                        ? 'bg-blue-600 text-white'
                        : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

            {/* Volume controls */}
            <div className="mt-6 grid grid-cols-2 gap-6">
              <VolumeControl
                label="Source"
                volume={sourceVolume}
                onChange={setSourceVolume}
                isDark={isDark}
                testId="source-volume"
              />
              <VolumeControl
                label="Translation"
                volume={translationVolume}
                onChange={setTranslationVolume}
                isDark={isDark}
                testId="translation-volume"
              />
            </div>
          </div>

          {/* Events list */}
          {events.length > 0 && (
            <div className={`mt-6 rounded-xl p-6 ${isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'}`}>
              <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Session Events
              </h2>
              <div className="space-y-1">
                {events.map((evt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (sourceRef.current) sourceRef.current.currentTime = evt.time;
                      if (translationRef.current) translationRef.current.currentTime = evt.time;
                      setCurrentTime(evt.time);
                    }}
                    className={`w-full text-left flex items-center gap-3 px-3 py-1.5 rounded text-sm transition-colors ${
                      isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className={`font-mono text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {formatTime(evt.time)}
                    </span>
                    <EventBadge type={evt.type} isDark={isDark} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VolumeControl({
  label,
  volume,
  onChange,
  isDark,
  testId,
}: {
  label: string;
  volume: number;
  onChange: (v: number) => void;
  isDark: boolean;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <label className={`text-xs font-medium mb-1 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          data-testid={`${testId}-slider`}
          className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500"
          style={{
            background: `linear-gradient(to right, ${isDark ? '#3b82f6' : '#2563eb'} ${volume * 100}%, ${isDark ? '#374151' : '#e5e7eb'} ${volume * 100}%)`,
          }}
        />
        <span className={`text-xs w-8 text-right ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}

function EventMarker({
  event,
  duration,
  isDark,
}: {
  event: RecordingEvent;
  duration: number;
  isDark: boolean;
}) {
  if (event.type === 'session_start' || event.type === 'session_end') return null;
  const left = `${(event.time / duration) * 100}%`;
  const color = event.type.includes('mute')
    ? 'bg-yellow-500'
    : event.type.includes('passthrough')
    ? 'bg-purple-500'
    : event.type === 'crash_recovery'
    ? 'bg-red-500'
    : 'bg-blue-500';

  return (
    <div
      className={`absolute top-0 w-1 h-2 ${color} rounded-full -translate-x-1/2`}
      style={{ left }}
      title={`${event.type} at ${formatTime(event.time)}`}
    />
  );
}

function EventBadge({ type, isDark }: { type: string; isDark: boolean }) {
  const colors: Record<string, string> = {
    session_start: isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700',
    session_end: isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600',
    mute: isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
    unmute: isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
    passthrough_on: isDark ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-700',
    passthrough_off: isDark ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-700',
    crash_recovery: isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700',
    reconnect: isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700',
  };

  const color = colors[type] ?? (isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600');

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}
