# Phase 5: ABC Software

**Goal**: The Audio Booth Connector binary connects to the server, participates in WebRTC sessions with real Opus audio, and supports a headless mode for testing. TFT display is deferred until hardware is available.

**Duration**: ~1.5 weeks

**Depends on**: Phase 2 (WebRTC signaling & SFU working)

## Steps

### 5.1 Configuration & Startup

- Parse `/etc/streamlate/abc.toml` using `config` + `serde`
- Initialize `tracing` (output to journald)
- Validate config (server URL, credentials, audio devices)
- Set up signal handlers (SIGTERM, SIGINT → graceful shutdown)
- `--headless` flag (behind `#[cfg(feature = "headless")]`) for e2e testing

Verify: Binary starts, loads config, logs initialization.

### 5.2 Audio Backend Trait

Abstract audio I/O behind a trait so headless and hardware modes share all other code:

```rust
trait AudioBackend: Send + 'static {
    /// Start capturing audio. Returns a receiver of Opus-encoded frames.
    fn start_capture(&self) -> Result<Receiver<OpusFrame>>;

    /// Start playback. Returns a sender to feed decoded PCM.
    fn start_playback(&self) -> Result<Sender<PcmFrame>>;

    /// Get current capture RMS level (for VU meters / health).
    fn capture_level(&self) -> f32;

    /// Get current playback RMS level.
    fn playback_level(&self) -> f32;
}
```

Two implementations:
- **`AlsaBackend`** — real ALSA via `cpal` (default, for hardware)
- **`HeadlessBackend`** — sine wave generator + verification sink (behind `headless` feature)

This is NOT a mock. Both implementations feed real Opus-encoded audio into the same WebRTC pipeline.

### 5.3 Headless Audio Backend

For e2e testing:

- **Capture**: Generates a 440 Hz sine wave at 48 kHz mono, Opus-encodes it, feeds into the WebRTC track. This is the same code path as ALSA capture, just with a synthetic PCM source.
- **Playback**: Receives decoded PCM from the WebRTC track, writes to a ring buffer. Runs FFT on the ring buffer to detect dominant frequency.
- **Verification HTTP endpoint** (headless only, port 9090):

```
GET http://localhost:9090/audio/received
→ {
    "dominant_frequency_hz": 880.0,
    "rms_db": -12.3,
    "samples_received": 48000,
    "duration_seconds": 1.0
  }

GET http://localhost:9090/state
→ {
    "state": "session_active",
    "session_name": "Main Hall — Spanish",
    "uptime_seconds": 120
  }
```

Verify: Headless binary emits 440 Hz, verification endpoint reports received audio.

### 5.4 Network Management

- Detect available network interfaces
- Connect via Ethernet (preferred) or Wi-Fi
- Wi-Fi: use `wpasupplicant` via D-Bus or subprocess
- Monitor connectivity (periodic ping or HTTP check to server)
- On loss: trigger reconnection state and retry
- In headless mode: skip Wi-Fi management (container networking is already connected)

Verify: ABC connects to network, detects disconnection.

### 5.5 Server Registration

- `POST /api/v1/abc/register` with `abc_id` + `abc_secret`
- On success: receive signaling WebSocket URL
- On failure: retry with exponential backoff
- Store received WebSocket URL for signaling

Verify: ABC registers with server, appears in server's ABC list as "online".

### 5.6 Signaling WebSocket

- Connect to signaling WebSocket URL from registration
- Handle messages:
  - `session-start` → begin WebRTC negotiation
  - `session-stop` → tear down session
  - `ping`/`pong` → keepalive
  - `error` → log
- Send messages:
  - `offer`/`answer`, `ice-candidate` (WebRTC signaling)
  - `health` (periodic stats)
  - `pong` responses
- Auto-reconnect WebSocket on close/error

Verify: WebSocket stays connected, responds to pings.

### 5.7 WebRTC Peer Connection

- On `session-start`:
  1. Create `RTCPeerConnection` via `webrtc-rs`
  2. Configure Opus codec (48kHz, mono, 32kbps)
  3. Add local audio track (source from audio backend capture)
  4. Handle remote track (translated audio → audio backend playback)
  5. Exchange SDP and ICE via signaling WebSocket
  6. Monitor ICE state, handle disconnection/restart

Verify: WebRTC connection established when session starts.

### 5.8 Audio Capture Pipeline (Source → Server)

- Get capture stream from audio backend
- Feed Opus frames as RTP packets on the WebRTC track
- Software gain control (configurable via `abc.toml` and server commands)

Pipeline (same for both backends):
```
AudioBackend::start_capture() → Opus Frames → RTP → WebRTC Track
```

Buffer size: 20ms frames (960 samples at 48kHz).

Verify: Server receives audio from ABC. Translator hears source audio.

### 5.9 Audio Playback Pipeline (Server → Output)

- Receive Opus frames from incoming WebRTC track
- Decode to PCM
- Feed to audio backend playback
- Software gain control
- Handle jitter buffer (use `webrtc-rs` built-in jitter buffer)

Pipeline:
```
WebRTC Track → RTP → Jitter Buffer → Opus Decode → AudioBackend::start_playback()
```

Verify: Translated audio delivered to audio backend. In headless mode, verification endpoint reports received frequency.

### 5.10 Main State Machine

```rust
enum AbcState {
    Booting,
    ConnectingNetwork,
    ConnectingServer,
    Idle,                    // Connected, waiting for session
    SessionStarting,         // WebRTC negotiation
    SessionActive {          // Audio flowing
        session_name: String,
        started_at: Instant,
    },
    Reconnecting {           // Transient failure
        previous: Box<AbcState>,
    },
    Error(String),
}
```

State transitions drive audio pipeline start/stop. Display updates will be added when display backend is implemented (see Deferred section).

Verify: State machine transitions correctly through all states.

### 5.11 Resilience

- **WebSocket reconnect**: Exponential backoff (1s → 30s cap)
- **WebRTC reconnect**: ICE restart via signaling, or full renegotiation
- **Audio device error** (ALSA mode): Detect, log error, retry every 5s
- **Graceful shutdown**: On SIGTERM, close WebRTC, close WebSocket, flush logs

Verify: Kill server → ABC retries. Network partition → ABC reconnects.

### 5.12 Systemd Service

```ini
# /etc/systemd/system/streamlate-abc.service
[Unit]
Description=Streamlate Audio Booth Connector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/streamlate-abc --config /etc/streamlate/abc.toml
Restart=always
RestartSec=5
WatchdogSec=60

[Install]
WantedBy=multi-user.target
```

Verify: Service starts on boot, restarts on crash.

### 5.13 Cross-Compilation

- Cross-compile for `aarch64-unknown-linux-gnu`
- Verify binary runs on ARM64 (even if hardware testing is deferred)

Verify: Binary compiles and starts on aarch64.

## Deferred: TFT Display

The 2.4″ TFT display (ILI9341 over SPI) is **deferred until hardware is acquired**. The architecture supports this cleanly:

- A `DisplayBackend` trait will be added (similar to `AudioBackend`):
  - `NullDisplay` — current default, logs state changes to stdout
  - `Ili9341Display` — future, drives the physical screen
- The state machine already emits state transitions; wiring to a display is additive
- Display states (boot logo, network status, VU meters) are specified in [docs/abc.md](../docs/abc.md) but not implemented yet
- **No code changes to non-display modules will be needed** when the display is added

When hardware arrives, add a new phase (5b) covering:
- `embedded-graphics` + `ili9341` SPI driver integration
- Display state rendering (all states from [docs/abc.md](../docs/abc.md))
- VU meter rendering from audio RMS levels
- Hardware watchdog timer integration
- End-to-end test on physical K2B board

## Definition of Done

- [ ] ABC binary starts and registers with server
- [ ] Appears as "online" in translation client
- [ ] Session start → audio captured (440 Hz in headless) and sent to server
- [ ] Translated audio received and delivered to audio backend
- [ ] Headless verification endpoint confirms received audio with correct frequency
- [ ] Reconnection works (server restart, network partition)
- [ ] Graceful shutdown on SIGTERM
- [ ] Cross-compiles for aarch64
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

These tests run the actual `streamlate-abc` binary (compiled with `--features headless`) in a Docker container. The binary uses real WebRTC and real Opus — only the ALSA and display hardware are replaced.

```
e2e/tests/phase-5/
  ├── abc-lifecycle.spec.ts
  └── abc-resilience.spec.ts
```

| Test | What It Proves |
|------|----------------|
| ABC container starts, registers with server, API shows it online | Real binary works end-to-end |
| Start session → translator browser detects 440 Hz from ABC | ABC's Opus encode → WebRTC → SFU → browser pipeline works |
| Translator injects 880 Hz → ABC verification endpoint reports 880 Hz | ABC receives and decodes real audio |
| ABC `/state` endpoint reports `session_active` during session | State machine transitions are real |
| Stop server container → restart → ABC reconnects and re-registers | Reconnection logic works in the real binary |
| Docker network disconnect on ABC → wait 10s → reconnect → audio resumes | Network resilience under real conditions |
| SIGTERM ABC container → exits cleanly (exit code 0) | Graceful shutdown works |

**Key distinction from Phase 2 tests**: Phase 2 used a browser-based ABC simulation. Phase 5 tests run the actual `streamlate-abc` binary — proving the Rust code, not just the WebRTC protocol.
