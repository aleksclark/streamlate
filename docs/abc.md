# Audio Booth Connector (ABC)

The ABC is a small, dedicated device that sits in or near a translation booth. It captures the source audio feed (analog in), streams it to the server over WebRTC, receives the translated audio back from the server, and outputs it (analog out). It is designed to be zero-configuration for end users.

## Hardware

| Part | Model | Notes |
|------|-------|-------|
| SBC | K2B (Allwinner H618, quad-core ARM64, 1.5 GHz) | 2 GB LPDDR4, 16 GB eMMC |
| Display | 2.4″ TFT LCD (320×240, SPI, ILI9341) | Touch-capable |
| Audio I/O | USB audio adapter or on-board codec | Stereo line-in / line-out, 3.5 mm jacks |
| Network | Wi-Fi (on-board) or Ethernet (USB adapter or on-board) | |

## Software Stack

| Layer | Technology |
|-------|------------|
| OS | Minimal Linux (Armbian or custom Buildroot image) |
| Application | Rust binary (`streamlate-abc`) |
| WebRTC | `webrtc-rs` (pure-Rust WebRTC) |
| Audio capture/playback | ALSA via `cpal` crate |
| Display driver | `embedded-graphics` + SPI framebuffer (`ili9341` crate) — **deferred** |
| Configuration | `/etc/streamlate/abc.toml` |

## Boot & Connection Lifecycle

```
Power On
  │
  ├─ OS boot (systemd service: streamlate-abc)
  │
  ├─ Load config from /etc/streamlate/abc.toml
  │    ├─ server_url
  │    ├─ abc_id (UUID)
  │    ├─ abc_secret (API key)
  │    └─ network preferences
  │
  ├─ Connect to network (Wi-Fi or Ethernet)
  │    └─ Display: "Connecting to network..."
  │
  ├─ Register with server (REST: POST /api/v1/abc/register)
  │    ├─ Authenticate with abc_id + abc_secret
  │    └─ Receive signaling WebSocket URL
  │
  ├─ Open signaling WebSocket
  │    └─ Display: "Connected — Idle" + ABC name
  │
  └─ Wait for session assignment
       │
       ├─ Server sends session-start signal
       │    ├─ Negotiate WebRTC peer connection (via signaling WS)
       │    ├─ Start capturing source audio → send as WebRTC audio track
       │    ├─ Receive translated audio track → play through line-out
       │    └─ Display: "Session Active" + session name + VU levels
       │
       ├─ Network interruption
       │    ├─ Display: "Reconnecting..."
       │    ├─ Attempt reconnect with exponential backoff
       │    └─ Resume session if still active on server
       │
       └─ Session ends (server signal or admin action)
            ├─ Tear down WebRTC connection
            └─ Display: "Connected — Idle"
```

## Display States

> **Note**: TFT display implementation is deferred until hardware is acquired. The display state model is defined here for future implementation. The ABC binary uses a `DisplayBackend` trait — current default is `NullDisplay` (logs state to stdout).

| State | Screen Content |
|-------|----------------|
| Booting | Streamlate logo, firmware version |
| Connecting to network | Spinner, "Connecting to network…" |
| Network connected, server unreachable | Wi-Fi/Eth icon, "Server unreachable — retrying" |
| Connected — Idle | ABC name, server status, IP address |
| Session Active | Session name, source VU meter, translated VU meter, duration |
| Reconnecting | Last known state dimmed, "Reconnecting…" overlay |
| Error | Error message, instruction to contact admin |

## Headless / E2E Testing Mode

The ABC binary supports a `--headless` flag (behind `#[cfg(feature = "headless")]`) for automated testing:

- **Audio capture** replaced by a 440 Hz sine wave generator (same Opus encode pipeline)
- **Audio playback** replaced by a verification sink with HTTP endpoint on port 9090
- **Display** skipped entirely
- **Network management** skipped (container networking is pre-connected)
- All other code paths (WebRTC, signaling, state machine, reconnection) are **identical** to production mode

This is NOT a mock — it exercises the full pipeline except hardware I/O. See [docs/e2e-testing.md](e2e-testing.md) for details.

## Audio Pipeline

```
Line-In (3.5mm) ──► ALSA Capture ──► Opus Encode ──► WebRTC Track (to server)

WebRTC Track (from server) ──► Opus Decode ──► ALSA Playback ──► Line-Out (3.5mm)
```

- **Codec**: Opus, 48 kHz, mono, ~32 kbps (voice-optimized profile)
- **Buffer**: Target ≤ 20 ms capture-to-send latency; ≤ 40 ms end-to-end one-way
- **Gain**: Software-adjustable per-direction via server command

## Configuration File

```toml
# /etc/streamlate/abc.toml

[server]
url = "https://streamlate.example.com"

[identity]
abc_id = "550e8400-e29b-41d4-a716-446655440000"
abc_secret = "sk_abc_..."

[network]
prefer = "ethernet"  # "ethernet" | "wifi"
wifi_ssid = "TranslationBooth"
wifi_password = "..."

[audio]
capture_device = "default"
playback_device = "default"
capture_gain = 1.0
playback_gain = 1.0

[display]
brightness = 80  # 0-100
rotation = 0     # 0, 90, 180, 270
```

## Provisioning

1. Flash OS image to eMMC (factory or via USB)
2. Write `abc.toml` with server URL and credentials
3. Register ABC in server admin UI (generates `abc_id` + `abc_secret`)
4. Power on — device auto-connects

## Resilience

- **Network loss**: Exponential backoff reconnect (1s → 2s → 4s → … → 30s cap). Session survives if server hasn't timed it out.
- **Server restart**: ABC detects WebSocket close, re-registers, rejoins active session if any.
- **Audio device loss**: Detect via ALSA error, display error state, retry periodically.
- **Watchdog**: Hardware watchdog timer resets device if main process hangs for >60s.

## Security

- All communication over TLS (DTLS for WebRTC media)
- ABC authenticates to server with pre-shared API key
- No open ports on the ABC — all connections are outbound
- Firmware updates via server push (signed images, verified on boot)
