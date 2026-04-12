# Translation Client

A web-based single-page application (SPA) used by translators and administrators. Translators use it to connect to an Audio Booth Connector, hear the source audio, and speak their translation. Administrators use it to manage the system.

## Technology

| Concern | Choice |
|---------|--------|
| Framework | React 18+ with TypeScript |
| Build tool | Vite |
| UI library | shadcn/ui (Tailwind CSS) |
| State management | Zustand |
| API client | Generated from OpenAPI spec (`openapi-typescript-codegen`) |
| WebRTC | Browser native `RTCPeerConnection` |
| Audio processing | Web Audio API |
| Routing | React Router v6 |
| Theme | Dark mode default, light mode toggle |

## User Roles

| Role | Capabilities |
|------|-------------|
| **Translator** | Start/stop sessions, translate, view own session history |
| **Admin** | Everything a translator can do, plus manage users, ABCs, recordings, system settings |

## Screens

### 1. Login

- Email + password form
- JWT token stored in memory (access) and httpOnly cookie (refresh)

### 2. Dashboard (Translator View)

```
┌─────────────────────────────────────────────┐
│  Streamlate              [User ▾] [🌓]      │
├─────────────────────────────────────────────┤
│                                             │
│  Your Name: [ Maria Rodriguez    ] [Save]   │
│                                             │
│  Available Booths                           │
│  ┌──────────────────────────────────────┐   │
│  │ 🟢 Main Hall — Booth A     [Start] │   │
│  │ 🟢 Main Hall — Booth B     [Start] │   │
│  │ 🔴 Room 201 — Booth A   (in use)   │   │
│  │ ⚪ Room 201 — Booth B   (offline)  │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Active Sessions                            │
│  ┌──────────────────────────────────────┐   │
│  │ Main Hall A — Maria (you) — 01:23:45│   │
│  └──────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### 3. Translation Session

The primary workspace during active translation.

```
┌─────────────────────────────────────────────┐
│  Main Hall — Booth A          [End Session] │
├─────────────────────────────────────────────┤
│                                             │
│  Source Audio (from booth)                  │
│  ████████████████░░░░░░░░  ← VU meter      │
│  Volume: [━━━━━━●━━━━━━━]                  │
│                                             │
│  Your Translation                           │
│  ██████████░░░░░░░░░░░░░░  ← VU meter      │
│  Volume: [━━━━━━━━━●━━━━]                  │
│                                             │
│  ┌───────────┐ ┌───────────┐                │
│  │  🔇 Mute  │ │ 🔊 Pass-  │                │
│  │ Translate │ │  through  │                │
│  └───────────┘ └───────────┘                │
│                                             │
│  Channel Health                             │
│  Latency: 45ms  │  Packet Loss: 0.1%       │
│  Jitter: 3ms    │  Bitrate: 32 kbps        │
│                                             │
│  ┌──────────┐                               │
│  │ QR Code  │  ← Scan to listen            │
│  │          │                               │
│  └──────────┘                               │
│  Duration: 01:23:45                         │
│                                             │
└─────────────────────────────────────────────┘
```

### 4. Admin Panel

Tabs or sidebar navigation:

| Section | Content |
|---------|---------|
| Users | List, create, edit, delete admin and translator accounts |
| Booth Connectors | List ABCs, register new, edit name, rotate credentials, view status |
| Recordings | List completed sessions, play back, download, delete |
| Sessions | View active sessions, force-stop if needed |
| Settings | System-wide config (STUN/TURN, recording defaults) |

### 5. Recording Playback

Plays back a recorded session as it happened live:

- Two synchronized audio tracks: source + translation
- Independent volume controls for each
- Timeline scrubber
- Playback speed control (0.5×–2×)

## Audio Controls

| Control | Behavior |
|---------|----------|
| **Mute Translation** | Stops sending translator's audio to listeners. Source audio continues to translator. Listeners hear silence. |
| **Passthrough** | Forwards original source audio directly to listeners (for music segments, etc.). Translator still hears source. |
| **Source Volume** | Adjusts translator's local playback volume of the source feed |
| **Translation Volume** | Adjusts the gain of the outgoing translation stream |

## WebRTC Flow

1. Translator clicks "Start" on an available booth
2. Client requests session creation via REST API
3. Server responds with signaling WebSocket URL
4. Client opens WebSocket, exchanges SDP offer/answer
5. ICE candidates exchanged, DTLS handshake
6. Two audio tracks established:
   - **Incoming**: Source audio from ABC (receive-only)
   - **Outgoing**: Translator's microphone (send-only)
7. On session end, client sends stop request, tears down peer connection

## Mobile Layout

The translation session view is the priority for mobile optimization:

- VU meters stack vertically
- Controls are large touch targets (min 48px)
- QR code collapsible
- Channel health in expandable section
- Tested for viewport widths ≥ 320px

## State Management

```
SessionStore {
  currentSession: Session | null
  availableBooths: ABC[]
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error'
  audioState: {
    sourceLevel: number        // 0-1, VU meter
    translationLevel: number   // 0-1, VU meter
    isMuted: boolean
    isPassthrough: boolean
  }
  channelHealth: {
    latency: number
    packetLoss: number
    jitter: number
    bitrate: number
  }
}
```
