# Listener Client

A lightweight web SPA for audience members to listen to live translated audio. Optimized for simplicity — a listener should go from opening the URL to hearing audio in under 3 seconds.

## Technology

Same stack as the Translation Client (shared component library):

| Concern | Choice |
|---------|--------|
| Framework | React 18+ with TypeScript |
| Build tool | Vite |
| UI library | shadcn/ui (Tailwind CSS) |
| API client | Generated from OpenAPI spec |
| WebRTC | Browser native `RTCPeerConnection` |
| Audio | Web Audio API |
| Theme | Dark mode default, light mode toggle |

## Entry Points

| Method | URL | Behavior |
|--------|-----|----------|
| Session picker | `/listen` | Shows list of active sessions to choose from |
| Direct link | `/listen/{session_id}` | Auto-connects to the specified session |
| QR code | Same as direct link | Scanned from translator or other listener's device |

## Screens

### 1. Session Picker

```
┌─────────────────────────────────────────────┐
│  Streamlate — Listener          [🌓]        │
├─────────────────────────────────────────────┤
│                                             │
│  Select a session to listen:                │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 🟢 Main Hall — Spanish              │   │
│  │    Translator: Maria R. — 01:23:45  │   │
│  │                            [Listen] │   │
│  ├──────────────────────────────────────┤   │
│  │ 🟢 Main Hall — French               │   │
│  │    Translator: Jean D. — 00:45:12   │   │
│  │                            [Listen] │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  No account needed.                         │
│                                             │
└─────────────────────────────────────────────┘
```

### 2. Listening View

```
┌─────────────────────────────────────────────┐
│  Main Hall — Spanish            [🌓] [Stop] │
├─────────────────────────────────────────────┤
│                                             │
│  ████████████████░░░░░░░░  ← VU meter      │
│                                             │
│  Volume: [━━━━━━━━━●━━━━]                  │
│                                             │
│  Translator: Maria Rodriguez               │
│  Duration: 01:23:45                         │
│                                             │
│  ┌──────────┐                               │
│  │ QR Code  │  ← Share with others         │
│  │          │                               │
│  └──────────┘                               │
│                                             │
│  Status: 🟢 Connected                      │
│                                             │
└─────────────────────────────────────────────┘
```

## WebRTC Flow

1. Listener selects session (or arrives via direct link)
2. Client requests listener slot: `POST /api/v1/sessions/{id}/listen`
3. Server responds with signaling WebSocket URL
4. WebSocket SDP exchange — listener is **receive-only** (no microphone access needed)
5. Single audio track: translated audio from the session
6. On disconnect or session end, display "Session ended" message

## Audio

- **Receive only** — no microphone permission required
- Volume control via Web Audio API `GainNode`
- VU meter via `AnalyserNode`
- Auto-play requires user gesture (browser policy) — "Tap to listen" button on first load

## Authentication

**None required.** The listener client is publicly accessible. Sessions are identified by their ID, which acts as a capability URL. The server may optionally restrict sessions to require a simple PIN, configured per-session by the admin.

Optional PIN flow:
1. Listener navigates to `/listen/{session_id}`
2. If session has a PIN, prompt for it
3. `POST /api/v1/sessions/{id}/listen` with PIN in body
4. Server validates and returns signaling URL

## Session End Behavior

When a session ends while a listener is connected:

1. Server sends close frame on signaling WebSocket
2. Client displays: "This session has ended"
3. Button: "Back to sessions" → returns to session picker
4. If other sessions are active, show them inline

## Reconnection

- If WebRTC connection drops, auto-reconnect with exponential backoff
- Display "Reconnecting…" overlay during reconnection
- Max 5 retry attempts, then show "Connection lost" with manual retry button

## Mobile Optimization

- Full-width layout, large touch targets
- VU meter and volume slider are the primary visual elements
- QR code is prominent for easy sharing in conference settings
- Works in both portrait and landscape
- Minimal data usage: receive-only Opus audio at ~32 kbps
