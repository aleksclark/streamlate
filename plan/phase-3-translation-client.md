# Phase 3: Translation Client MVP

**Goal**: Translators can log in, see available booths, start a session, hear source audio, speak their translation, and control the session.

**Duration**: ~2 weeks

**Depends on**: Phase 2 (WebRTC working), Phase 0 (frontend scaffold)

## Steps

### 3.1 API Client Integration

- Run OpenAPI codegen to generate TypeScript client
- Set up API client with base URL config and interceptors:
  - Attach `Authorization: Bearer` header
  - Handle 401 → refresh token → retry
  - Handle refresh failure → redirect to login
- Create typed API hooks (e.g., `useUsers`, `useAbcs`, `useSessions`)

Verify: Can call health endpoint from React app.

### 3.2 Auth Flow

- Login page:
  - Email + password form
  - Submit → call `POST /api/v1/auth/login`
  - Store access token in memory (Zustand store)
  - Refresh token handled via httpOnly cookie (automatic)
- Auth guard (React Router):
  - Protected routes redirect to login if no token
  - On app load, attempt silent refresh
- Logout button → `POST /api/v1/auth/logout` → clear state → redirect

Verify: Login works, protected routes require auth, token refresh works transparently.

### 3.3 Dashboard Screen

- Display translator's name (editable via `PUT /api/v1/auth/me` or similar)
- List available ABCs:
  - Fetch from `GET /api/v1/abcs`
  - Show status: idle (green), in-session (red), offline (grey)
  - "Start" button on idle ABCs
- List active sessions (own sessions highlighted)
- Auto-refresh every 5 seconds (or WebSocket push — future)

Verify: Dashboard shows ABCs with correct statuses.

### 3.4 Session Creation & WebRTC Connection

When translator clicks "Start":
1. `POST /api/v1/sessions` with selected ABC
2. Receive signaling WebSocket URL
3. Connect to signaling WebSocket
4. Exchange SDP offer/answer
5. Exchange ICE candidates
6. Receive source audio track → play through speakers
7. Capture microphone → send as translation track

Implement WebRTC hook (`useWebRTC`):
```typescript
interface UseWebRTC {
  connectionState: RTCPeerConnectionState
  connect(signalingUrl: string): Promise<void>
  disconnect(): void
  sourceStream: MediaStream | null     // incoming from ABC
  setMuted(muted: boolean): void
  setPassthrough(enabled: boolean): void
}
```

Request microphone permission on session start (not before).

Verify: Translator hears source audio, can speak translation.

### 3.5 Translation Session Screen

Build the session UI per [translation-client.md](../docs/translation-client.md):

- Source audio VU meter (Web Audio API `AnalyserNode` on incoming stream)
- Translation VU meter (on outgoing microphone stream)
- Source volume slider (`GainNode`)
- Translation volume slider (gain on outgoing track)
- Mute button → sends `mute` signaling message
- Passthrough button → sends `passthrough` signaling message
- Session duration timer
- "End Session" button → `POST /api/v1/sessions/{id}/stop`

Verify: VU meters respond to audio, mute/passthrough controls work.

### 3.6 Channel Health Display

- Parse `health` messages from signaling WebSocket
- Display in the session screen:
  - Latency (ms)
  - Packet loss (%)
  - Jitter (ms)
  - Bitrate (kbps)
- Collapsible section (expanded by default on desktop, collapsed on mobile)

Verify: Health stats update in real time during active session.

### 3.7 Connection State Handling

Handle all connection states gracefully:

| State | UI |
|-------|-----|
| Connecting | Spinner overlay, "Connecting to booth…" |
| Connected | Normal session view |
| Reconnecting | Dimmed overlay, "Reconnecting…" |
| Disconnected | "Connection lost" with retry button |
| Error | Error message with details |

Implement auto-reconnect (exponential backoff) for transient failures.

Verify: Kill network, see reconnecting UI, restore network, session resumes.

### 3.8 Layout & Theming

- Set up Tailwind + shadcn/ui with dark mode default
- Implement theme toggle (dark/light)
- Responsive layout:
  - Desktop: side-by-side VU meters, controls in a row
  - Mobile: stacked layout, large touch targets (≥48px)
- Test at 320px, 375px, 768px, 1024px viewports

Verify: App looks good on phone and desktop, dark and light modes work.

### 3.9 Navigation Structure

```
/login           → Login page
/                → Dashboard (translator view)
/session/:id     → Active translation session
/admin/*         → Admin panel (Phase 7)
/recordings      → Recording playback (Phase 6)
```

Implement with React Router v6. Admin routes gated on `role === 'admin'`.

## Definition of Done

- [ ] Translator can log in
- [ ] Dashboard shows ABCs with live status
- [ ] Can start a session with an idle ABC
- [ ] Source audio plays, translation captured from mic
- [ ] VU meters and volume controls work
- [ ] Mute and passthrough controls work
- [ ] Channel health displayed
- [ ] Reconnection works
- [ ] Responsive layout, dark/light theme
- [ ] End session works cleanly
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

Playwright drives the actual Translation Client served from nginx in Docker. No source-level imports — tests interact only through the browser.

```
e2e/tests/phase-3/
  ├── login-flow.spec.ts
  ├── dashboard.spec.ts
  ├── session-workflow.spec.ts
  └── audio-controls.spec.ts
```

| Test | What It Proves |
|------|----------------|
| Fill login form → submit → dashboard appears | Auth UI wired to real API |
| Login with wrong password → error message shown | Error path works, not just happy path |
| Dashboard lists ABC sim as idle (green indicator) | ABC list fetched from real server |
| Click "Start" on idle ABC → session screen with "Connected" state | Session creation + WebRTC negotiation works through UI |
| Source VU meter shows level > -40 dB while ABC sim sends 440 Hz | VU meter driven by real audio, not CSS animation |
| Mute button → open listener in separate context → listener audio silent | Mute is a real signaling message, not UI-only |
| Unmute → listener detects audio again | Unmute restores forwarding |
| Passthrough → listener detects 440 Hz (source frequency) | Passthrough control sends real signaling |
| "End Session" → dashboard reappears, ABC status returns to idle | Full lifecycle through UI |
| Channel health section shows non-zero latency/jitter values | Health stats are real measurements, not placeholder text |

**Key technique**: VU meter assertions read the `aria-valuenow` or data attribute of the VU component, which must be driven by the `AnalyserNode` — a CSS-only animation would not produce correlated values when audio starts/stops.
