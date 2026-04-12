import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useThemeStore } from '../stores/themeStore';
import { api } from '../api';
import { VUMeter } from '../components/VUMeter';
import { VolumeSlider } from '../components/VolumeSlider';
import { ChannelHealth } from '../components/ChannelHealth';
import { ConnectionStatus } from '../components/ConnectionStatus';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);

  const session = useSessionStore((s) => s.session);
  const connectionState = useSessionStore((s) => s.connectionState);
  const audio = useSessionStore((s) => s.audio);
  const health = useSessionStore((s) => s.health);
  const duration = useSessionStore((s) => s.duration);
  const error = useSessionStore((s) => s.error);
  const connectWebRTC = useSessionStore((s) => s.connectWebRTC);
  const stopSession = useSessionStore((s) => s.stopSession);
  const setMuted = useSessionStore((s) => s.setMuted);
  const setPassthrough = useSessionStore((s) => s.setPassthrough);
  const setSourceVolume = useSessionStore((s) => s.setSourceVolume);
  const setTranslationVolume = useSessionStore((s) => s.setTranslationVolume);

  useEffect(() => {
    if (!sessionId) return;

    async function init() {
      try {
        const sessionData = await api.sessions.get(sessionId!);
        await connectWebRTC(sessionData);
      } catch {
        navigate('/');
      }
    }

    if (connectionState === 'disconnected' && !session) {
      init();
    }

    return () => {
      // Cleanup handled by disconnect
    };
  }, [sessionId, connectionState, session, connectWebRTC, navigate]);

  const handleEndSession = async () => {
    await stopSession();
    navigate('/');
  };

  const isDark = theme === 'dark';

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {session?.session_name ?? 'Translation Session'}
          </h1>
          <div className="flex items-center gap-4 mt-1">
            <ConnectionStatus state={connectionState} />
            <span className={`text-sm tabular-nums ${
              isDark ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {formatDuration(duration)}
            </span>
          </div>
        </div>
        <button
          onClick={handleEndSession}
          className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          End Session
        </button>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-900/20 border border-red-500/30 text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {connectionState === 'reconnecting' && (
        <div className="mb-6 p-3 bg-orange-900/20 border border-orange-500/30 text-orange-400 rounded-lg text-sm flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
          Reconnecting...
        </div>
      )}

      <div className="space-y-6">
        <section className={`rounded-lg p-5 ${
          isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'
        }`}>
          <h2 className={`text-sm font-semibold mb-4 ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>
            Source Audio (from booth)
          </h2>
          <div className="space-y-3">
            <VUMeter level={audio.sourceLevel} label="Level" />
            <VolumeSlider
              value={audio.sourceVolume}
              onChange={setSourceVolume}
              label="Volume"
            />
          </div>
        </section>

        <section className={`rounded-lg p-5 ${
          isDark ? 'bg-gray-900' : 'bg-white border border-gray-200'
        }`}>
          <h2 className={`text-sm font-semibold mb-4 ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>
            Your Translation
          </h2>
          <div className="space-y-3">
            <VUMeter level={audio.translationLevel} label="Level" />
            <VolumeSlider
              value={audio.translationVolume}
              onChange={setTranslationVolume}
              label="Volume"
            />
          </div>
        </section>

        <div className="flex gap-3">
          <button
            onClick={() => setMuted(!audio.isMuted)}
            className={`flex-1 py-3 px-4 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
              audio.isMuted
                ? 'bg-red-600 text-white hover:bg-red-700'
                : isDark
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {audio.isMuted ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072" />
              </svg>
            )}
            {audio.isMuted ? 'Unmute Translation' : 'Mute Translation'}
          </button>

          <button
            onClick={() => setPassthrough(!audio.isPassthrough)}
            className={`flex-1 py-3 px-4 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
              audio.isPassthrough
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : isDark
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            {audio.isPassthrough ? 'Passthrough ON' : 'Passthrough'}
          </button>
        </div>

        <ChannelHealth health={health} />
      </div>
    </div>
  );
}
