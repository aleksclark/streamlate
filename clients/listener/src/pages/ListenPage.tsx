import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getSession, requestListenAccess, fetchActiveSessions, type SessionDetail, type SessionListItem } from '../lib/api';
import { useListenerWebRTC } from '@streamlate/shared/hooks/useListenerWebRTC';
import { useAudioAnalyser } from '@streamlate/shared/hooks/useAudioAnalyser';
import { VUMeter } from '@streamlate/shared/components/VUMeter';
import { VolumeSlider } from '@streamlate/shared/components/VolumeSlider';
import { ConnectionStatus } from '@streamlate/shared/components/ConnectionStatus';
import { ThemeToggle } from '../components/ThemeToggle';
import { PinPrompt } from '../components/PinPrompt';
import { QRShare } from '../components/QRShare';

type PageState = 'loading' | 'pin-required' | 'connecting' | 'listening' | 'session-ended' | 'error';

export function ListenPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [volume, setVolume] = useState(1);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [otherSessions, setOtherSessions] = useState<SessionListItem[]>([]);

  const webrtc = useListenerWebRTC();
  const webrtcRef = useRef(webrtc);
  webrtcRef.current = webrtc;

  const audio = useAudioAnalyser(webrtc.audioStream);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (webrtc.audioStream && audioRef.current) {
      audioRef.current.srcObject = webrtc.audioStream;
    }
  }, [webrtc.audioStream]);

  useEffect(() => {
    audio.setVolume(volume);
  }, [volume, audio]);

  useEffect(() => {
    if (webrtc.error === 'session-ended') {
      setPageState('session-ended');
      fetchActiveSessions().then(items => {
        setOtherSessions(items.filter(s => s.id !== sessionId));
      }).catch(() => {});
    }
  }, [webrtc.error, sessionId]);

  useEffect(() => {
    if (webrtc.connectionState === 'connected') {
      setPageState('listening');
      setAutoplayBlocked(false);
    }
  }, [webrtc.connectionState]);

  const connectToSession = useCallback(async (pin?: string) => {
    if (!sessionId) return;
    try {
      setPageState('connecting');
      const { signaling_url } = await requestListenAccess(sessionId, pin);

      let wsUrl = signaling_url;
      if (typeof window !== 'undefined' && signaling_url.includes('localhost')) {
        const loc = window.location;
        wsUrl = `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws/listen/${sessionId}`;
      }

      webrtcRef.current.connect(wsUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      if (msg.includes('Incorrect PIN') || msg.includes('forbidden')) {
        setPageState('pin-required');
        setErrorMsg('Incorrect PIN. Please try again.');
      } else {
        setPageState('error');
        setErrorMsg(msg);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setPageState('error');
      setErrorMsg('No session ID');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        setSession(s);

        if (s.state !== 'active') {
          setPageState('session-ended');
          return;
        }

        const pinFromUrl = searchParams.get('pin');
        if (s.has_pin && !pinFromUrl) {
          setPageState('pin-required');
        } else {
          connectToSession(pinFromUrl || undefined);
        }
      } catch (e) {
        if (cancelled) return;
        setPageState('error');
        setErrorMsg(e instanceof Error ? e.message : 'Failed to load session');
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId, searchParams, connectToSession]);

  const handlePinSubmit = useCallback((pin: string) => {
    setErrorMsg('');
    connectToSession(pin);
  }, [connectToSession]);

  const handleStop = useCallback(() => {
    webrtcRef.current.disconnect();
    navigate('/listen');
  }, [navigate]);

  const handleTapToListen = useCallback(() => {
    setAutoplayBlocked(false);
    const ctx = audio.analyserRef.current?.context;
    if (ctx && ctx instanceof AudioContext && ctx.state === 'suspended') {
      ctx.resume();
    }
  }, [audio.analyserRef]);

  if (pageState === 'loading') {
    return (
      <PageShell>
        <div className="text-gray-400 dark:text-gray-400 text-center py-20" data-testid="loading">Loading session…</div>
      </PageShell>
    );
  }

  if (pageState === 'pin-required') {
    return (
      <PageShell>
        <PinPrompt
          sessionName={session?.session_name || 'Session'}
          error={errorMsg}
          onSubmit={handlePinSubmit}
          onBack={() => navigate('/listen')}
        />
      </PageShell>
    );
  }

  if (pageState === 'error') {
    return (
      <PageShell>
        <div className="text-center py-20">
          <p className="text-red-400 text-lg mb-4" data-testid="error-message">{errorMsg || 'Session not found'}</p>
          <button
            onClick={() => navigate('/listen')}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-sm"
            data-testid="back-button"
          >
            Back to sessions
          </button>
        </div>
      </PageShell>
    );
  }

  if (pageState === 'session-ended') {
    return (
      <PageShell>
        <div className="text-center py-20">
          <p className="text-xl mb-4" data-testid="session-ended-message">This session has ended</p>
          <button
            onClick={() => navigate('/listen')}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm mb-6"
            data-testid="back-to-sessions"
          >
            Back to sessions
          </button>
          {otherSessions.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-gray-400 mb-3">Other active sessions:</p>
              {otherSessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/listen/${s.id}`)}
                  className="block w-full max-w-sm mx-auto px-4 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-sm mb-2"
                >
                  {s.session_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell sessionName={session?.session_name} onStop={handleStop}>
      {autoplayBlocked && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <button
            onClick={handleTapToListen}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-xl font-medium text-white"
            data-testid="tap-to-listen"
          >
            Tap to listen
          </button>
        </div>
      )}

      <audio ref={audioRef} muted data-testid="audio-element" className="hidden" />

      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {webrtc.connectionState === 'reconnecting' && (
          <div className="bg-yellow-900/50 dark:bg-yellow-900/50 border border-yellow-700 rounded-lg px-4 py-3 text-center text-yellow-300 dark:text-yellow-300 text-sm" data-testid="reconnecting-overlay">
            Reconnecting…
          </div>
        )}

        {webrtc.connectionState === 'disconnected' && webrtc.error && webrtc.error !== 'session-ended' && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-3 text-center text-red-300 text-sm" data-testid="connection-lost">
            <p className="mb-2">Connection lost</p>
            <button
              onClick={() => connectToSession()}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-sm text-white"
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        )}

        <VUMeter level={audio.level} rmsDb={audio.rmsDb} className="px-4" />

        <VolumeSlider volume={volume} onChange={setVolume} className="px-4" />

        <div className="space-y-2 px-4">
          <div className="text-sm text-gray-400">
            Translator: <span className="text-gray-200 dark:text-gray-200" data-testid="translator-name">{session?.translator_name || '—'}</span>
          </div>
          <div className="text-sm text-gray-400">
            Duration: <SessionDuration startedAt={session?.started_at} />
          </div>
        </div>

        <div className="px-4">
          <ConnectionStatus state={webrtc.connectionState} />
        </div>

        <div className="flex justify-center px-4">
          <QRShare sessionId={sessionId!} />
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({
  children,
  sessionName,
  onStop,
}: {
  children: React.ReactNode;
  sessionName?: string;
  onStop?: () => void;
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h1 className="text-lg font-semibold truncate" data-testid="page-title">
          {sessionName || 'Streamlate — Listener'}
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          {onStop && (
            <button
              onClick={onStop}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
              data-testid="stop-button"
            >
              Stop
            </button>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function SessionDuration({ startedAt }: { startedAt?: string }) {
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    if (!startedAt) return;
    function update() {
      const start = new Date(startedAt!).getTime();
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span data-testid="session-duration">{elapsed}</span>;
}
