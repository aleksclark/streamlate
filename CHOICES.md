# Technical Choices

Every significant technology and design decision, with rationale and alternatives considered.

## Language & Runtime

### Rust for Server + ABC

**Chosen**: Rust (stable toolchain)

| Factor | Assessment |
|--------|-----------|
| **Why** | Single language for both server and embedded ABC. Memory safety without GC means predictable latency for real-time audio. Excellent WebRTC and async ecosystem. Cross-compiles to ARM64 for the SBC. |
| **Alternatives considered** | **Go** — simpler but worse ARM embedded story, no `cpal` equivalent. **C++** — fast but memory-unsafe, slower iteration. **Node.js** — poor fit for the ABC, GC pauses in audio pipeline. |
| **Risk** | Steeper learning curve. Slower initial velocity. Mitigated by well-defined module boundaries. |

### TypeScript + React for Web Clients

**Chosen**: TypeScript, React 18+, Vite

| Factor | Assessment |
|--------|-----------|
| **Why** | Industry standard for SPAs. TypeScript catches contract drift with the server. React has the largest component ecosystem. Vite is fast and lean. |
| **Alternatives considered** | **SolidJS** — faster runtime but smaller ecosystem. **Svelte** — less mainstream, fewer WebRTC examples. **Vue** — viable but team preference is React. |

## WebRTC

### webrtc-rs (Pure Rust)

**Chosen**: `webrtc-rs` crate

| Factor | Assessment |
|--------|-----------|
| **Why** | Pure Rust, no C dependencies. Works on both x86_64 (server) and ARM64 (ABC). Active development, Pion (Go) port. |
| **Alternatives considered** | **libwebrtc (C++)** — battle-tested but painful to build and cross-compile. **GStreamer + webrtcbin** — powerful but heavyweight for the ABC. **mediasoup** — Node.js only. |
| **Risk** | Less mature than libwebrtc. Mitigated by Opus-only audio profile (simpler than full video). |

### SFU Architecture (Not P2P, Not MCU)

**Chosen**: Selective Forwarding Unit

| Factor | Assessment |
|--------|-----------|
| **Why** | Server can fan out audio to N listeners without O(N) connections from the translator. Enables recording at the server. Simplifies NAT traversal (only client↔server). |
| **Alternatives considered** | **P2P** — doesn't scale to multiple listeners, can't record centrally. **MCU (mixing)** — unnecessary transcoding overhead for single-track audio relay. |

## Audio Codec

### Opus, 48 kHz, Mono, 32 kbps

**Chosen**: Opus with voice-optimized profile

| Factor | Assessment |
|--------|-----------|
| **Why** | Mandatory in WebRTC (no negotiation issues). Excellent speech quality at 32 kbps. Built-in FEC for packet loss resilience. Sub-5ms encoding latency. |
| **Alternatives considered** | None seriously — Opus is the clear winner for WebRTC voice. |
| **Parameters** | Mono (translation is single-speaker), CBR for consistent bitrate, FEC enabled, DTX disabled (continuous for VU meters). |

## Database

### SQLite (WAL Mode)

**Chosen**: SQLite via `rusqlite`

| Factor | Assessment |
|--------|-----------|
| **Why** | Zero deployment complexity — single file, embedded. WAL mode supports concurrent reads. More than adequate for the expected load (dozens of concurrent sessions, not thousands). Simplifies backups. |
| **Alternatives considered** | **PostgreSQL** — overkill for initial deployment, adds operational complexity. **sled** — embedded but less mature, no SQL. |
| **Migration path** | If scale demands it, swap to PostgreSQL. The `rusqlite` query interface can be abstracted behind a trait. |

## HTTP Framework

### axum

**Chosen**: `axum` (tokio ecosystem)

| Factor | Assessment |
|--------|-----------|
| **Why** | Tower-based middleware (composable). Excellent ergonomics with extractors. First-class WebSocket support. Built on `hyper` and `tokio`. `utoipa` integration for OpenAPI. |
| **Alternatives considered** | **actix-web** — fast but different async model, less composable middleware. **warp** — filter-based API is harder to read at scale. |

## OpenAPI & Codegen

### utoipa + openapi-typescript-codegen

**Chosen**: Generate OpenAPI spec from Rust derive macros, generate TypeScript client from spec

| Factor | Assessment |
|--------|-----------|
| **Why** | Single source of truth in Rust code. No spec drift. TypeScript client is always in sync. Derive macros are less boilerplate than hand-writing YAML. |
| **Alternatives considered** | **Hand-written OpenAPI YAML** — drifts from implementation. **gRPC** — not browser-native (needs grpc-web proxy). **tRPC** — TypeScript-only, doesn't fit Rust server. |

## Authentication

### JWT + Refresh Token Rotation

**Chosen**: Short-lived JWT access tokens (15 min) + opaque refresh tokens in httpOnly cookies

| Factor | Assessment |
|--------|-----------|
| **Why** | Stateless access token validation (no DB lookup per request). Refresh token rotation detects token theft. httpOnly cookie prevents XSS token exfiltration. |
| **Alternatives considered** | **Session cookies** — simpler but requires DB lookup on every request. **OAuth2/OIDC** — overengineered for a self-hosted tool with its own user store. |

## UI Library

### shadcn/ui + Tailwind CSS

**Chosen**: shadcn/ui (copy-paste component library built on Radix primitives)

| Factor | Assessment |
|--------|-----------|
| **Why** | High-quality accessible components. Not a package dependency — components are owned in-tree. Tailwind for consistent styling. Dark mode built in. |
| **Alternatives considered** | **MUI** — heavy bundle, opinionated styling. **Headless UI** — fewer pre-built components. **Ant Design** — enterprise-heavy aesthetic. |

## Audio Capture (ABC)

### cpal (Cross-Platform Audio Library)

**Chosen**: `cpal` crate for ALSA access on Linux

| Factor | Assessment |
|--------|-----------|
| **Why** | Pure Rust ALSA backend. Handles device enumeration, sample format conversion. Well-maintained. |
| **Alternatives considered** | **Direct ALSA FFI** — more control but more boilerplate. **PipeWire** — not needed on a minimal embedded system. |

## Display (ABC)

### embedded-graphics + ILI9341 SPI

**Chosen**: `embedded-graphics` crate with `ili9341` driver

| Factor | Assessment |
|--------|-----------|
| **Why** | No framebuffer driver needed — direct SPI writes. `embedded-graphics` provides drawing primitives. Low resource usage, no X11/Wayland. |
| **Alternatives considered** | **Linux framebuffer + minifb** — heavier, requires kernel driver. **lvgl-rs** — more features but larger dependency. |

## Recording Format

### Ogg/Opus Streaming Container

**Chosen**: Wrap raw Opus packets in Ogg pages, flush frequently

| Factor | Assessment |
|--------|-----------|
| **Why** | Crash-resilient (every flushed page is independently decodable). No transcoding (Opus packets pass through directly). Browser-native playback. Standard tooling (ffmpeg, VLC). |
| **Alternatives considered** | **Raw Opus packets + custom index** — requires custom player. **WAV** — would require decoding Opus then re-encoding PCM, wasteful. **Matroska/WebM** — heavier container, less streaming-friendly. |

## State Management (Frontend)

### Zustand

**Chosen**: Zustand for React state management

| Factor | Assessment |
|--------|-----------|
| **Why** | Minimal API, no boilerplate. Works outside React components (useful for WebRTC callbacks). Small bundle. |
| **Alternatives considered** | **Redux Toolkit** — more structure than needed. **Jotai** — atomic model doesn't fit session-centric state. **React Context** — re-render performance issues with frequent audio state updates. |

## Configuration

### TOML Files + Environment Variable Overrides

**Chosen**: `config` crate reading TOML with env var overlay

| Factor | Assessment |
|--------|-----------|
| **Why** | TOML is readable and Rust-native. Env vars allow Docker/CI overrides. Single config file per component. |
| **Alternatives considered** | **YAML** — more complex parsing, less Rust-idiomatic. **JSON** — no comments. **CLI flags only** — too many parameters. |

---

## Testing & Validation

### Docker Compose + Playwright for E2E Testing

**Chosen**: Docker Compose for running built artifacts, Playwright for browser-driven tests

| Factor | Assessment |
|--------|-----------|
| **Why** | Tests run against the same binaries/bundles deployed in production — no source imports, no mocks. Docker Compose provides a reproducible environment. Playwright can drive real Chromium browsers with WebRTC support, inject audio via Web Audio API, and detect frequencies via FFT. |
| **Alternatives considered** | **Cypress** — limited WebRTC support, can't control Web Audio API as deeply. **Selenium** — heavier, slower. **Custom test harness** — fragile, not standard. **testcontainers** — Rust/Go only, no browser driving. |

### Frequency Detection for Audio Verification

**Chosen**: Inject known sine waves (440 Hz, 880 Hz), detect via FFT in AnalyserNode

| Factor | Assessment |
|--------|-----------|
| **Why** | A known-frequency sine wave can only appear at the receiver if real Opus-encoded audio traversed the full WebRTC pipeline. This is unfakeable — no stub or mock can produce the correct frequency at the output without a working codec and transport. |
| **Alternatives considered** | **Check "audio flowing" boolean** — too easy to fake. **Record and compare** — complex, brittle. **Latency measurement** — proves connection but not audio content. |

### ABC Headless Mode (Feature Flag, Not Mock)

**Chosen**: Same binary with `--features headless` that swaps ALSA for synthetic I/O

| Factor | Assessment |
|--------|-----------|
| **Why** | Exercises the real code path (WebRTC, Opus, signaling, state machine) without requiring physical hardware. A separate mock binary would diverge from production code. Feature flags keep the two modes in the same compilation unit. |
| **Alternatives considered** | **Separate mock binary** — would diverge from production. **Hardware-in-the-loop only** — blocks CI, slow. **Docker volume with ALSA loopback** — fragile, hard to detect frequency. |

---

*This document should be reviewed and updated as implementation proceeds and new decisions are made.*
