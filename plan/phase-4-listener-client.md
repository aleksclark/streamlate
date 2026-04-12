# Phase 4: Listener Client MVP

**Goal**: Listeners can select a live session and hear the translated audio.

**Duration**: ~1 week

**Depends on**: Phase 2 (WebRTC), Phase 3 (sessions are being created)

## Steps

### 4.1 Project Setup

- Listener client is a separate Vite project (`clients/listener`)
- Shares components from `clients/shared` (VU meter, volume slider, theme)
- Separate entry point and routing
- API client generated from same OpenAPI spec

Verify: `npm run dev` starts listener client on different port.

### 4.2 Session Picker Screen

- Fetch active sessions: `GET /api/v1/sessions?state=active`
- Display list:
  - Session name
  - Translator name
  - Duration (live timer)
  - Listener count
  - PIN indicator (lock icon if PIN required)
  - "Listen" button
- Auto-refresh every 5 seconds
- No authentication required

Verify: Active sessions appear in the list.

### 4.3 Direct Link & QR Entry

- Route: `/listen/{session_id}`
- If session exists and is active → go directly to listening view
- If session requires PIN → show PIN prompt first
- If session doesn't exist or is ended → show "Session not found" with link back to picker
- QR codes from translator/listener clients encode this URL

Verify: Direct link auto-connects. Invalid session shows helpful error.

### 4.4 PIN Entry

- Simple modal/page with 4-digit PIN input
- `POST /api/v1/sessions/{id}/listen` with PIN in request body
- On success → receive signaling WebSocket URL
- On failure → "Incorrect PIN, try again"
- If no PIN required → skip straight to signaling

Verify: PIN-protected session requires correct PIN. Unprotected session skips prompt.

### 4.5 WebRTC Listener Connection

- Connect to signaling WebSocket (no auth token, just session ID + optional PIN)
- Negotiate receive-only WebRTC connection:
  - No `getUserMedia` call — no microphone permission needed
  - Single incoming audio track (translated audio)
- Handle browser autoplay policy:
  - Show "Tap to listen" button if autoplay blocked
  - On user gesture, resume AudioContext and start playback

Implement listener WebRTC hook (`useListenerWebRTC`):
```typescript
interface UseListenerWebRTC {
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  connect(signalingUrl: string): Promise<void>
  disconnect(): void
  audioStream: MediaStream | null
}
```

Verify: Listener hears translated audio. No microphone permission prompt.

### 4.6 Listening View

- VU meter for incoming translated audio
- Volume slider
- Translator name
- Session name
- Duration timer (since session started, not since listener joined)
- Connection status indicator
- QR code for sharing (same URL the listener is on)
- "Stop" button → disconnects and returns to picker

Verify: All UI elements work, volume control adjusts level.

### 4.7 Session End Handling

When session ends while listener is connected:
1. Server sends WebSocket close frame (or `session-stop` message)
2. Display: "This session has ended"
3. Show button: "Back to sessions"
4. If other active sessions exist, list them inline for quick switch

Verify: End session from translator side → listener sees end message.

### 4.8 Reconnection

- Auto-reconnect on WebRTC or WebSocket failure
- Exponential backoff: 1s → 2s → 4s → … → 15s
- Max 5 attempts
- Show "Reconnecting…" overlay during attempts
- After max attempts: "Connection lost" with manual "Retry" button

Verify: Interrupt network, listener reconnects automatically.

### 4.9 Responsive & Theming

- Full-width mobile layout
- VU meter prominent and large
- Volume slider easy to use with touch
- Dark mode default, light mode toggle
- Minimal chrome — the focus is on listening

Verify: Works well on phone, tablet, desktop.

## Definition of Done

- [ ] Session picker shows active sessions
- [ ] Direct link works (with and without PIN)
- [ ] Listener hears translated audio (receive-only WebRTC)
- [ ] VU meter and volume control work
- [ ] QR code displayed for sharing
- [ ] Session end handled gracefully
- [ ] Auto-reconnection works
- [ ] Mobile-friendly, dark/light theme
- [ ] No microphone permission requested
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

Playwright drives the Listener Client in separate browser contexts. A full session (ABC sim + translator) is set up first, then listener tests validate receiving real audio.

```
e2e/tests/phase-4/
  ├── session-picker.spec.ts
  ├── direct-link.spec.ts
  ├── pin.spec.ts
  ├── listening.spec.ts
  └── session-end.spec.ts
```

| Test | What It Proves |
|------|----------------|
| Session picker lists active session with correct name and translator | Session list from real API, not hardcoded |
| Direct link `/listen/{id}` → listening view appears | URL routing works end-to-end |
| PIN-protected session → wrong PIN rejected → correct PIN accepted | PIN validated server-side, not client-only |
| Listener receives audio, VU meter > -40 dB | Real audio flows to receive-only WebRTC |
| Listener detects 880 Hz (translator's injected frequency) | Correct audio track forwarded |
| Volume slider at 0 → page audio silent (but WebRTC stream still active) | Volume is local gain, not stream mute |
| Translator ends session → listener sees "session ended" text | Session end propagated to listeners |
| Open 3 listener browser contexts → all detect audio, API reports 3 listeners | SFU fan-out is real, not single-consumer |
| No microphone permission dialog appears during listener flow | Receive-only WebRTC correctly configured |
