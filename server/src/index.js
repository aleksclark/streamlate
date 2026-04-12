import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.STREAMLATE_JWT_SECRET || 'e2e-test-secret';
const PORT = parseInt(process.env.PORT || '8080', 10);
const BIND = process.env.STREAMLATE_BIND || `0.0.0.0:${PORT}`;

const app = express();
const wsInstance = expressWs(app);

app.use(cors());
app.use(express.json());

const users = new Map();
const abcs = new Map();
const sessions = new Map();
const listenerCounts = new Map();

const adminId = uuidv4();
const adminEmail = 'admin@streamlate.local';
const adminPassword = 'admin123';
users.set(adminId, {
  id: adminId,
  email: adminEmail,
  password: adminPassword,
  name: 'Admin',
  role: 'admin',
});

console.log(`Bootstrap admin: ${adminEmail} / ${adminPassword}`);

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Missing token' } });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid token' } });
  }
}

// Health
app.get('/api/v1/system/health', (_req, res) => {
  const activeSessions = [...sessions.values()].filter(s => s.state === 'active').length;
  res.json({
    status: 'ok',
    version: '0.1.0',
    uptime_seconds: Math.floor(process.uptime()),
    active_sessions: activeSessions,
    connected_abcs: abcs.size,
    connected_translators: activeSessions,
    active_listeners: [...listenerCounts.values()].reduce((a, b) => a + b, 0),
  });
});

// Auth
app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = [...users.values()].find(u => u.email === email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid credentials' } });
  }
  const access_token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refresh_token = jwt.sign({ sub: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ access_token, refresh_token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// Sessions - list (public for listeners, auth for full details)
app.get('/api/v1/sessions', (req, res) => {
  const stateFilter = req.query.state;
  let items = [...sessions.values()];
  if (stateFilter) {
    items = items.filter(s => s.state === stateFilter);
  }
  const publicItems = items.map(s => ({
    id: s.id,
    session_name: s.session_name,
    translator_name: s.translator_name || 'Translator',
    started_at: s.started_at,
    listener_count: listenerCounts.get(s.id) || 0,
    has_pin: !!s.pin,
    state: s.state,
  }));
  res.json({ items: publicItems, cursor: null });
});

// Sessions - create (auth required)
app.post('/api/v1/sessions', authMiddleware, (req, res) => {
  const { abc_id, session_name, pin, translator_name } = req.body;
  const id = uuidv4();
  const session = {
    id,
    abc_id: abc_id || uuidv4(),
    translator_id: req.user.sub,
    translator_name: translator_name || req.user.name || 'Translator',
    session_name: session_name || 'Unnamed Session',
    state: 'active',
    pin: pin || null,
    started_at: new Date().toISOString(),
    signaling_url: `ws://localhost:${PORT}/ws/translate/${id}`,
  };
  sessions.set(id, session);
  listenerCounts.set(id, 0);
  res.status(201).json(session);
});

// Sessions - get
app.get('/api/v1/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } });
  }
  res.json({
    ...session,
    listener_count: listenerCounts.get(session.id) || 0,
  });
});

// Sessions - stop (auth required)
app.post('/api/v1/sessions/:id/stop', authMiddleware, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } });
  }
  session.state = 'completed';
  session.ended_at = new Date().toISOString();

  const wsClients = listenerWsClients.get(session.id) || [];
  for (const ws of wsClients) {
    try {
      ws.send(JSON.stringify({ type: 'session-stop', session_id: session.id }));
      ws.close(1000, 'Session ended');
    } catch {}
  }
  listenerWsClients.delete(session.id);
  listenerCounts.set(session.id, 0);

  res.json({ status: 'stopped' });
});

// Sessions - listen (public, optional PIN)
app.post('/api/v1/sessions/:id/listen', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } });
  }
  if (session.state !== 'active') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Session is not active' } });
  }
  if (session.pin) {
    const { pin } = req.body || {};
    if (pin !== session.pin) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'Incorrect PIN' } });
    }
  }
  const bindParts = BIND.split(':');
  const host = req.headers.host || `localhost:${bindParts[bindParts.length - 1]}`;
  const protocol = req.secure ? 'wss' : 'ws';
  const signalingUrl = `${protocol}://${host}/ws/listen/${session.id}`;
  res.json({ signaling_url: signalingUrl });
});

// WebSocket signaling for listeners
const listenerWsClients = new Map();

// Track active audio generators per session
const sessionAudioGenerators = new Map();

function startAudioGenerator(sessionId) {
  if (sessionAudioGenerators.has(sessionId)) return;

  const sampleRate = 48000;
  const frequency = 880;
  const packetDurationMs = 20;
  const samplesPerPacket = (sampleRate * packetDurationMs) / 1000;
  let phase = 0;
  const phaseIncrement = (2 * Math.PI * frequency) / sampleRate;

  const interval = setInterval(() => {
    const clients = listenerWsClients.get(sessionId) || [];
    const connectedClients = clients.filter(c => c.peerConnection && c.audioSender);
    if (connectedClients.length === 0) return;

    const samples = new Float32Array(samplesPerPacket);
    for (let i = 0; i < samplesPerPacket; i++) {
      samples[i] = 0.5 * Math.sin(phase);
      phase += phaseIncrement;
    }
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
  }, packetDurationMs);

  sessionAudioGenerators.set(sessionId, interval);
}

function stopAudioGenerator(sessionId) {
  const interval = sessionAudioGenerators.get(sessionId);
  if (interval) {
    clearInterval(interval);
    sessionAudioGenerators.delete(sessionId);
  }
}

app.ws('/ws/listen/:sessionId', (ws, req) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session || session.state !== 'active') {
    ws.send(JSON.stringify({ type: 'error', code: 'not_found', message: 'Session not found or inactive' }));
    ws.close(1008, 'Session not found');
    return;
  }

  if (!listenerWsClients.has(sessionId)) {
    listenerWsClients.set(sessionId, []);
  }
  listenerWsClients.get(sessionId).push(ws);
  listenerCounts.set(sessionId, (listenerCounts.get(sessionId) || 0) + 1);

  ws.send(JSON.stringify({ type: 'welcome', session_id: sessionId }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      handleListenerSignaling(ws, sessionId, data);
    } catch (e) {
      console.error('Invalid signaling message:', e);
    }
  });

  ws.on('close', () => {
    const clients = listenerWsClients.get(sessionId) || [];
    const idx = clients.indexOf(ws);
    if (idx !== -1) clients.splice(idx, 1);
    const count = listenerCounts.get(sessionId) || 1;
    listenerCounts.set(sessionId, Math.max(0, count - 1));
    if (ws.peerConnection) {
      ws.peerConnection.close();
    }
  });

  ws.on('error', () => {});
});

async function handleListenerSignaling(ws, sessionId, data) {
  if (data.type === 'offer') {
    try {
      const { RTCPeerConnection, RTCSessionDescription, nonstandard } = await import('@roamhq/wrtc');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      ws.peerConnection = pc;

      const { RTCAudioSource } = nonstandard;
      const source = new RTCAudioSource();
      const track = source.createTrack();
      const sender = pc.addTrack(track);
      ws.audioSender = sender;
      ws.audioSource = source;

      const sampleRate = 48000;
      const frequency = 880;
      const packetDurationMs = 10;
      const samplesPerPacket = (sampleRate * packetDurationMs) / 1000;
      let phase = 0;
      const phaseIncrement = (2 * Math.PI * frequency) / sampleRate;
      const amplitude = 15000;

      ws.audioInterval = setInterval(() => {
        const samples = new Int16Array(samplesPerPacket);
        for (let i = 0; i < samplesPerPacket; i++) {
          samples[i] = Math.round(amplitude * Math.sin(phase));
          phase += phaseIncrement;
        }
        if (phase > 2 * Math.PI * 1000) phase -= 2 * Math.PI * 1000;
        try {
          source.onData({
            samples,
            sampleRate,
            bitsPerSample: 16,
            channelCount: 1,
            numberOfFrames: samplesPerPacket,
          });
        } catch {}
      }, packetDurationMs);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          if (ws.audioInterval) clearInterval(ws.audioInterval);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp ? { type: 'offer', sdp: data.sdp } : data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription.sdp }));
    } catch (e) {
      console.error('WebRTC signaling error:', e);
      ws.send(JSON.stringify({ type: 'error', message: 'WebRTC negotiation failed: ' + e.message }));
    }
  } else if (data.type === 'ice-candidate') {
    if (ws.peerConnection && data.candidate) {
      try {
        await ws.peerConnection.addIceCandidate(data.candidate);
      } catch (e) {
        console.error('ICE candidate error:', e);
      }
    }
  } else if (data.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
  }
}

// Translator signaling WS (minimal - for e2e test setup)
app.ws('/ws/translate/:sessionId', (ws, req) => {
  const { sessionId } = req.params;
  ws.send(JSON.stringify({ type: 'welcome', session_id: sessionId }));
  ws.on('message', () => {});
  ws.on('close', () => {});
});

const [host, portStr] = BIND.split(':');
const bindPort = parseInt(portStr || String(PORT), 10);

app.listen(bindPort, host || '0.0.0.0', () => {
  console.log(`Streamlate server listening on ${BIND}`);
});
