# Phase 2: WebRTC Foundation

**Goal**: WebRTC signaling over WebSocket, SFU audio forwarding, session audio lifecycle.

**Duration**: ~2 weeks

**Depends on**: Phase 1

## Steps

### 2.1 WebSocket Signaling Server

- Add WebSocket upgrade endpoints in axum:
  - `GET /ws/translate/{session_id}` — for translators (Bearer auth)
  - `GET /ws/abc/{abc_id}` — for ABCs (API key auth)
  - `GET /ws/listen/{session_id}` — for listeners (optional PIN)
- Authenticate on upgrade (reject before upgrade if invalid)
- Define JSON signaling message types per [webrtc.md](../docs/webrtc.md):
  - `offer`, `answer`, `ice-candidate`, `ice-restart`
  - `session-start`, `session-stop`
  - `mute`, `passthrough`
  - `health`, `error`
  - `ping`, `pong`
- Implement ping/pong keepalive (15s interval)
- Track connected WebSocket sessions in a `ConnectionManager` actor

Verify: WebSocket connects, auth works, ping/pong keeps connection alive.

### 2.2 WebRTC Peer Connection Management

- Integrate `webrtc-rs` crate
- Create `PeerConnection` wrapper that:
  - Accepts SDP offer, generates SDP answer (or vice versa)
  - Handles trickle ICE candidates
  - Configures Opus-only audio codec
  - Configures ICE servers (STUN, optional TURN)
  - Runs in ICE-Lite mode (server has public IP)
- Handle ICE connection state changes
- Handle ICE restart requests

Verify: Can create peer connection, exchange SDP/ICE via WebSocket.

### 2.3 Session Manager Actor

- Implement `SessionManager` as a tokio actor (mpsc channel):
  - `StartSession { session_id, abc_ws, translator_ws }`
  - `StopSession { session_id }`
  - `AddListener { session_id, listener_ws }`
  - `RemoveListener { session_id, listener_id }`
  - `HandleMute { session_id, muted }`
  - `HandlePassthrough { session_id, enabled }`
- Session manager owns all active session state
- Coordinates WebRTC setup between participants

Verify: Session manager creates/destroys sessions, handles messages.

### 2.4 Audio Track Forwarding (SFU Core)

The critical path. For each active session:

```
ABC source track ──► [Server receives RTP] ──► Forward to Translator peer
                                              ──► Forward to all Listener peers

Translator track ──► [Server receives RTP] ──► Forward to ABC peer
                                              ──► Forward to all Listener peers
```

Implementation:
- Use `webrtc-rs` `TrackRemote` to receive RTP packets
- Use `TrackLocal` (specifically `TrackLocalStaticRTP`) to forward packets
- For fan-out to listeners: each listener gets a `TrackLocalStaticRTP` that clones the same RTP packets

Handle mute:
- When muted, stop forwarding translator track to listeners (send silence or stop track)

Handle passthrough:
- When passthrough enabled, forward ABC source track to listeners instead of translator track

Verify: Two browser tabs exchange audio through the server.

### 2.5 Browser-Based Testing Harness

Since ABCs aren't built yet, create a simple test page:

```
test/webrtc-test.html
```

- Two instances in different tabs simulate ABC and translator
- "ABC" tab captures microphone, sends to server
- "Translator" tab receives audio, captures microphone, sends back
- Third tab acts as listener
- Uses the same signaling WebSocket protocol

This test harness validates the full audio pipeline before any frontend is built.

Verify: Speak in "ABC" tab → hear in "Translator" tab. Speak in "Translator" tab → hear in "Listener" tab.

### 2.6 Connection Health Monitoring

- Periodically collect WebRTC stats from each peer connection:
  - Round-trip time
  - Packet loss
  - Jitter
  - Bitrate
- Send stats to connected clients via `health` signaling message
- Log stats at `debug` level
- Expose via `GET /api/v1/sessions/{id}/health`

Verify: Health stats appear in signaling messages and REST endpoint.

### 2.7 Reconnection Handling

- Detect ICE `disconnected` / `failed` states
- Handle `ice-restart` message from clients
- If WebSocket drops but session is still active:
  - ABC: allow re-registration and session rejoin
  - Translator: allow WebSocket reconnect and WebRTC renegotiation
  - Listener: allow new listener connection to same session
- Session persists on server until explicitly stopped or timeout

Verify: Kill a peer's network, wait, reconnect — audio resumes.

### 2.8 Session Lifecycle Integration

Wire up the full lifecycle:
1. `POST /api/v1/sessions` creates DB record, returns signaling URL
2. Translator connects to signaling WebSocket
3. Server signals ABC to start session
4. Both peers negotiate WebRTC
5. Audio flows
6. `POST /api/v1/sessions/{id}/stop` tears down everything
7. Session state updated to `completed`

Handle edge cases:
- ABC disconnects mid-session → session enters "reconnecting" state
- Translator disconnects → same
- Both disconnect for >timeout → session auto-stops

Verify: Full lifecycle works end-to-end with the test harness.

## Definition of Done

- [ ] WebSocket signaling works with proper auth
- [ ] WebRTC peer connections established via signaling
- [ ] Audio flows between simulated ABC, translator, and listener
- [ ] Mute and passthrough work
- [ ] ICE restart / reconnection works
- [ ] Health metrics reported
- [ ] Full session lifecycle (create → active → stop) works
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

These tests prove **real audio** flows through the SFU. The ABC simulator emits 440 Hz. Playwright opens a browser acting as translator (injecting 880 Hz) and a browser acting as listener. Frequency detection is the proof.

```
e2e/tests/phase-2/
  ├── signaling.spec.ts
  ├── audio-flow.spec.ts
  ├── mute-passthrough.spec.ts
  └── reconnection.spec.ts
```

| Test | What It Proves |
|------|----------------|
| ABC sim connects → server REST reports it as online | Registration + status tracking real |
| Start session → ABC sim receives `session-start` via WebSocket | Signaling reaches ABC |
| Translator browser receives audio at 440 Hz (from ABC sim) | Full pipeline: ABC → Opus → SFU → WebRTC → browser |
| Translator injects 880 Hz → listener browser detects 880 Hz | Full pipeline: browser → SFU → browser |
| Mute → listener audio goes silent within 1s | Mute is server-side track switching, not UI-only |
| Unmute → listener detects 880 Hz again | Unmute restores real audio |
| Passthrough → listener detects 440 Hz (source, not translation) | Passthrough switches the forwarded track |
| Stop session → all peers disconnected, session state = `completed` | Clean teardown |
| Kill ABC sim container → wait 5s → restart → audio resumes at 440 Hz | Reconnection is real |
| Health endpoint reports non-zero latency for active session | Stats are measured, not hardcoded zeros |

**Critical**: The 440 Hz / 880 Hz frequency detection tests are the primary defense against "WebRTC connected but no real audio" fakes. These tests use Web Audio API `AnalyserNode` FFT to detect the dominant frequency — a sine wave at a known frequency can only appear if real Opus-encoded audio traversed the entire pipeline.
