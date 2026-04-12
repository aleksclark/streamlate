# WebRTC Architecture

All real-time audio in Streamlate flows over WebRTC. The server acts as a Selective Forwarding Unit (SFU) — it receives audio tracks from sources and forwards them to recipients without transcoding.

## Why SFU (Not Peer-to-Peer)

| Concern | P2P | SFU (chosen) |
|---------|-----|--------------|
| Listener scalability | Each listener = new connection from translator | Server fans out to N listeners |
| Recording | Must happen at an endpoint | Server can tap the stream |
| NAT traversal | Every pair must negotiate | Only client↔server negotiation |
| Mute / passthrough | Requires app-level relay | Server can switch tracks |
| ABC simplicity | Would need to handle N peers | Single connection to server |

## Topology

```
ABC ──────────► Server ──────────► Translator
(source audio)    │    (source audio)
                  │
                  │◄──────────── Translator
                  │  (translated audio)
                  │
                  ├──────────► ABC (translated playback)
                  ├──────────► Listener 1
                  ├──────────► Listener 2
                  └──────────► Listener N
```

Each session has these WebRTC peer connections at the server:

| Peer | Tracks | Direction (from server's perspective) |
|------|--------|--------------------------------------|
| ABC | 1 audio (source) | Receive |
| ABC | 1 audio (translated) | Send |
| Translator | 1 audio (source) | Send |
| Translator | 1 audio (translation) | Receive |
| Listener (×N) | 1 audio (translated) | Send |

## Signaling Protocol

Signaling happens over WebSocket. All messages are JSON.

### Connection Setup

```
Client                          Server
  │                               │
  ├── WS Connect ────────────────►│
  │   (with auth token in query)  │
  │                               │
  │◄── { type: "welcome",  ──────┤
  │      session_id: "..." }      │
  │                               │
  ├── { type: "offer",    ───────►│
  │     sdp: "..." }              │
  │                               │
  │◄── { type: "answer",  ───────┤
  │      sdp: "..." }             │
  │                               │
  ├── { type: "ice-candidate", ──►│   (multiple, trickle ICE)
  │     candidate: "..." }        │
  │                               │
  │◄── { type: "ice-candidate", ─┤
  │      candidate: "..." }       │
  │                               │
  │   [connection established]    │
```

### Session Control Messages

| Message | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `session-start` | Server → ABC | `{ session_id, session_name }` | Tells ABC to begin |
| `session-stop` | Server → ABC | `{ session_id }` | Tells ABC session is ending |
| `mute` | Translator → Server | `{ muted: bool }` | Toggle translation stream |
| `passthrough` | Translator → Server | `{ enabled: bool }` | Toggle source passthrough to listeners |
| `health` | Bidirectional | `{ latency, loss, jitter }` | Periodic health stats |
| `error` | Server → Client | `{ code, message }` | Error notification |
| `ping` / `pong` | Bidirectional | — | Keepalive (every 15s) |

## Codec

| Parameter | Value |
|-----------|-------|
| Codec | Opus |
| Sample rate | 48,000 Hz |
| Channels | Mono (1) |
| Bitrate | 32 kbps (CBR, voice profile) |
| Packet time | 20 ms |
| FEC | Enabled (in-band forward error correction) |
| DTX | Disabled (continuous transmission for VU meters) |

Opus is mandatory-to-implement in WebRTC and ideal for speech: low latency, excellent quality at low bitrate, built-in FEC.

## ICE / NAT Traversal

```toml
# Server config
[webrtc]
stun_servers = ["stun:stun.l.google.com:19302"]
turn_server = "turn:turn.example.com:3478"
turn_username = "streamlate"
turn_password = "..."
```

- **STUN**: Used by default for ICE candidate gathering
- **TURN**: Optional, for restrictive NAT environments. Server provides TURN credentials to clients via signaling.
- **ICE-Lite**: The server runs in ICE-Lite mode (it has a public IP), reducing negotiation time.

## Latency Budget

| Segment | Target |
|---------|--------|
| ABC capture → encode | ≤ 10 ms |
| Network (ABC → Server) | ≤ 20 ms (same region) |
| Server forwarding | ≤ 5 ms |
| Network (Server → Client) | ≤ 20 ms |
| Client decode → playback | ≤ 10 ms |
| **Total one-way** | **≤ 65 ms** |

For simultaneous interpretation, ≤ 150 ms one-way is considered acceptable. Our target of ≤ 65 ms provides excellent headroom.

## Reconnection Strategy

| Component | Strategy |
|-----------|----------|
| ABC | Detects ICE failure, re-signals via WebSocket, renegotiates. Session persists on server. |
| Translator | Detects ICE failure, shows "Reconnecting…", re-signals. If WebSocket also dropped, reconnect WS first. |
| Listener | Same as translator but simpler (receive-only). Max 5 retries. |

### ICE Restart

If a peer connection's ICE state transitions to `failed` or `disconnected`:

1. Client sends `{ type: "ice-restart" }` over signaling WebSocket
2. Server creates new offer with `iceRestart: true`
3. New ICE candidates exchanged
4. Connection resumes without creating a new session

## Security

- **DTLS-SRTP**: All media encrypted (mandatory in WebRTC)
- **Signaling WebSocket**: Authenticated via JWT token in query parameter
- **No data channels**: Only audio tracks are used — no arbitrary data exchange
- **Server validates all SDP**: Rejects unexpected tracks or codecs
