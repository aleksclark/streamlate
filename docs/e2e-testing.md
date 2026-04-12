# End-to-End Testing

Agentic development is prone to "fake progress" — components that appear complete but contain stubs, mocks, or no-ops. The antidote is an out-of-band test harness that exercises the **built artifacts** exactly as they would run in production, with no access to source internals.

## Principles

1. **Black-box only**: Tests interact with the system through its public interfaces (HTTP, WebSocket, WebRTC, audio streams). No importing source modules, no calling internal functions.
2. **Built artifacts**: The Docker Compose stack runs the same binaries/bundles that would be deployed. No `cargo run` or `vite dev` — only compiled outputs.
3. **Audio-verifiable**: WebRTC audio tests must prove real audio flows end-to-end. A sine wave injected at one end must be detected at the other. Silence, static, or "connection established" assertions are insufficient.
4. **Gated phases**: Every implementation phase defines validation tests that **must pass** before the phase is considered complete. No exceptions.
5. **CI-runnable**: The entire suite runs in GitHub Actions with no special hardware.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  streamlate  │  │  translation │  │   listener   │  │
│  │    server     │  │  client      │  │   client     │  │
│  │  (Rust bin)  │  │  (nginx)     │  │  (nginx)     │  │
│  │  :8080       │  │  :3001       │  │  :3002       │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐                                       │
│  │  abc-sim     │  Headless ABC simulator               │
│  │  (Rust bin)  │  (uses real WebRTC, fake audio I/O)   │
│  └──────────────┘                                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
        ▲
        │  Playwright (host or container)
        │  drives Chromium browsers
        │
┌───────┴──────────────────────────────────────────────┐
│  e2e/                                                │
│  ├── playwright.config.ts                            │
│  ├── fixtures/                                       │
│  │   ├── audio.ts          # inject/detect sine wave │
│  │   ├── api.ts            # REST helper             │
│  │   └── webrtc.ts         # WebRTC assertions       │
│  ├── tests/                                          │
│  │   ├── phase-1/          # per-phase test suites   │
│  │   ├── phase-2/                                    │
│  │   └── ...                                         │
│  └── docker-compose.yml                              │
└──────────────────────────────────────────────────────┘
```

## Components

### Docker Compose Stack

```yaml
# e2e/docker-compose.yml
services:
  server:
    build:
      context: ..
      dockerfile: e2e/docker/Dockerfile.server
    ports:
      - "8080:8080"
      - "50000-50100:50000-50100/udp"
    environment:
      STREAMLATE_JWT_SECRET: "e2e-test-secret"
      STREAMLATE_LOG_LEVEL: "debug"
      STREAMLATE_BIND: "0.0.0.0:8080"
      STREAMLATE_DB_PATH: "/tmp/streamlate-e2e.db"
      STREAMLATE_RECORDING_DIR: "/tmp/recordings"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/v1/system/health"]
      interval: 2s
      timeout: 5s
      retries: 10

  translation-client:
    build:
      context: ..
      dockerfile: e2e/docker/Dockerfile.translation-client
    ports:
      - "3001:80"
    depends_on:
      server:
        condition: service_healthy

  listener-client:
    build:
      context: ..
      dockerfile: e2e/docker/Dockerfile.listener-client
    ports:
      - "3002:80"
    depends_on:
      server:
        condition: service_healthy

  abc-sim:
    build:
      context: ..
      dockerfile: e2e/docker/Dockerfile.abc-sim
    depends_on:
      server:
        condition: service_healthy
    environment:
      ABC_SERVER_URL: "http://server:8080"
      ABC_ID: ""        # set by test setup
      ABC_SECRET: ""    # set by test setup
```

### Dockerfiles

```dockerfile
# e2e/docker/Dockerfile.server
FROM rust:1-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release -p streamlate-server
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/streamlate-server /usr/local/bin/
CMD ["streamlate-server"]
```

```dockerfile
# e2e/docker/Dockerfile.translation-client
FROM node:20 AS builder
WORKDIR /src
COPY clients/shared clients/shared
COPY clients/translation clients/translation
RUN cd clients/translation && npm ci && npm run build
FROM nginx:alpine
COPY --from=builder /src/clients/translation/dist /usr/share/nginx/html
COPY e2e/docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
```

```dockerfile
# e2e/docker/Dockerfile.abc-sim
FROM rust:1-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release -p streamlate-abc --features headless
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/streamlate-abc /usr/local/bin/
CMD ["streamlate-abc", "--headless"]
```

### ABC Simulator

The `streamlate-abc` binary gets a `--headless` mode (behind a `headless` feature flag) that:

- **Replaces ALSA capture** with a synthetic audio source (440 Hz sine wave, Opus-encoded)
- **Replaces ALSA playback** with a verification sink (records received audio to a ring buffer, exposes via a local HTTP endpoint for test assertions)
- **Skips TFT display** entirely
- **Otherwise uses the real code path**: real WebRTC, real signaling, real Opus codec, real network

This is NOT a mock — it exercises the entire ABC code path except hardware I/O.

### Audio Verification

The critical piece for defeating fake progress. Tests must prove **real audio** flows:

```typescript
// e2e/fixtures/audio.ts

/**
 * Inject a sine wave into a WebRTC peer connection via Web Audio API.
 * Returns a handle to stop the tone.
 */
async function injectSineWave(page: Page, frequency: number): Promise<ToneHandle>;

/**
 * Analyze incoming audio on a page's <audio> or WebRTC stream.
 * Uses AnalyserNode FFT to detect the dominant frequency.
 * Asserts that the detected frequency matches expected ± tolerance.
 */
async function assertAudioFrequency(
  page: Page,
  expectedHz: number,
  toleranceHz: number,
  timeoutMs: number
): Promise<void>;

/**
 * Assert that audio level (RMS) exceeds a threshold.
 * Used to verify audio is actually flowing, not silence.
 */
async function assertAudioAboveSilence(
  page: Page,
  thresholdDb: number,
  timeoutMs: number
): Promise<void>;

/**
 * Assert that audio is silent (below threshold).
 * Used to verify mute actually works.
 */
async function assertAudioSilent(
  page: Page,
  thresholdDb: number,
  durationMs: number
): Promise<void>;
```

The ABC simulator emits a known frequency (440 Hz). Tests on the translator side verify they receive 440 Hz. The translator page injects a different frequency (880 Hz). Tests on the listener side verify they receive 880 Hz. **Frequency detection is the proof that real audio traversed the full pipeline.**

### REST API Fixture

```typescript
// e2e/fixtures/api.ts

class StreamlateAPI {
  constructor(private baseUrl: string) {}

  /** Login, return access token */
  async login(email: string, password: string): Promise<string>;

  /** Create a user */
  async createUser(token: string, user: CreateUserRequest): Promise<User>;

  /** Register an ABC, return id + secret */
  async registerABC(token: string, name: string): Promise<ABCCredentials>;

  /** Create a session */
  async createSession(token: string, abcId: string, name: string): Promise<Session>;

  /** Stop a session */
  async stopSession(token: string, sessionId: string): Promise<void>;

  /** Get server health */
  async health(): Promise<HealthResponse>;

  /** Wait for server to be ready */
  async waitReady(timeoutMs: number): Promise<void>;

  /** Get first-run admin credentials from server logs */
  async getBootstrapCredentials(): Promise<{email: string, password: string}>;
}
```

## Per-Phase Validation Tests

Each phase has a corresponding test suite under `e2e/tests/phase-N/`. A phase is not complete until its test suite passes against the Docker Compose stack.

### Phase 0 Validation

**What could be faked**: Build succeeds but artifacts don't actually run.

```
e2e/tests/phase-0/
  └── smoke.spec.ts
```

| Test | Validates |
|------|-----------|
| Server binary starts and health check responds | Binary is a real executable, not a stub |
| Health check returns valid JSON with version | Response is structured, not hardcoded |
| OpenAPI spec endpoint returns valid OpenAPI 3.x JSON | Spec generation works |
| Frontend builds are served and render (translation client loads, listener client loads) | Vite build produces working bundles |

### Phase 1 Validation

**What could be faked**: CRUD endpoints that return hardcoded data, auth that accepts anything, password hashing that's a no-op.

```
e2e/tests/phase-1/
  ├── bootstrap.spec.ts
  ├── auth.spec.ts
  ├── users.spec.ts
  ├── abcs.spec.ts
  └── sessions.spec.ts
```

| Test | Validates |
|------|-----------|
| First run creates admin, credentials printed in logs | Bootstrap is real |
| Login with correct password returns tokens | Auth works |
| Login with wrong password returns 401 | Password is actually checked |
| Access protected endpoint without token → 401 | Auth middleware exists |
| Access protected endpoint with expired token → 401 | Token expiry is enforced |
| Refresh token returns new access token | Refresh flow works |
| Refresh with revoked token fails | Token revocation works |
| Create user, read it back, fields match | User CRUD is real persistence (not in-memory echo) |
| Delete user, read returns 404 | Delete actually deletes |
| Create user with duplicate email → 409 | Unique constraints enforced |
| Non-admin cannot create users → 403 | Role authorization works |
| Register ABC, read it back | ABC CRUD persists |
| ABC self-register with correct secret succeeds | ABC auth works |
| ABC self-register with wrong secret → 401 | ABC secret is validated |
| Create session with idle ABC succeeds | Session creation works |
| Create session with already-in-session ABC → 409 | State enforcement works |
| Rate limit exceeded → 429 | Rate limiting is real |
| **Restart server, data survives** | SQLite persistence is real, not in-memory |

The **restart test** is key: it stops the server container, starts it again, and verifies previously created data still exists. This catches in-memory-only implementations.

### Phase 2 Validation

**What could be faked**: WebSocket connects but signaling is a no-op, WebRTC "connects" but no audio flows, SFU claims to forward but drops packets.

```
e2e/tests/phase-2/
  ├── signaling.spec.ts
  ├── audio-flow.spec.ts
  ├── mute-passthrough.spec.ts
  └── reconnection.spec.ts
```

| Test | Validates |
|------|-----------|
| ABC sim connects, server shows it online via REST API | Registration + status tracking works |
| Start session → ABC sim receives `session-start` signal | Signaling reaches ABC |
| Translator page receives audio at 440 Hz (ABC sim's sine wave) | Full audio pipeline: ABC → SFU → Translator |
| Translator page injects 880 Hz, listener page receives 880 Hz | Full pipeline: Translator → SFU → Listener |
| Mute: listener audio goes silent within 1s | Mute actually stops forwarding |
| Unmute: listener audio resumes at 880 Hz | Unmute restores forwarding |
| Passthrough: listener receives 440 Hz (source) instead of 880 Hz | Passthrough switches audio source |
| Stop session → ABC sim receives `session-stop`, all peers disconnect | Clean teardown works |
| Kill ABC sim, wait, restart → audio resumes | Reconnection is real |
| Health endpoint returns non-zero latency/jitter for active session | Stats are measured, not hardcoded |

### Phase 3 Validation

**What could be faked**: UI renders but buttons don't work, WebRTC "connected" state shown but no real connection, VU meters animated but not driven by real audio.

```
e2e/tests/phase-3/
  ├── login-flow.spec.ts
  ├── dashboard.spec.ts
  ├── session-workflow.spec.ts
  └── audio-controls.spec.ts
```

| Test | Validates |
|------|-----------|
| Login form submits, dashboard appears | Auth UI is wired to real API |
| Login with wrong password shows error | Error handling works |
| Dashboard lists ABCs with correct status (idle ABC sim shows green) | ABC list is fetched from server |
| Click "Start" → session screen appears with "Connected" state | Session creation + WebRTC wired |
| Source VU meter shows activity (> -40 dB) when ABC sim sends audio | VU meter driven by real audio data |
| Translator VU meter shows activity when mic is active | Outgoing audio captured |
| Mute button → listener audio goes silent | Mute control sends real signaling message |
| Passthrough button → listener receives 440 Hz | Passthrough control works |
| End Session → returns to dashboard, ABC status returns to idle | Full lifecycle works |
| Channel health shows non-zero values | Health stats are real measurements |

### Phase 4 Validation

**What could be faked**: Listener page loads but never actually receives audio, session list is hardcoded, PIN check is client-side only.

```
e2e/tests/phase-4/
  ├── session-picker.spec.ts
  ├── direct-link.spec.ts
  ├── pin.spec.ts
  ├── listening.spec.ts
  └── session-end.spec.ts
```

| Test | Validates |
|------|-----------|
| Session picker shows active sessions with correct names | Session list from real API |
| Direct link `/listen/{id}` connects without session picker | URL routing works |
| PIN-protected session prompts for PIN | PIN check exists |
| Wrong PIN → rejected | PIN validated server-side |
| Correct PIN → audio plays | PIN unlocks real access |
| Listener receives 880 Hz from translator | Real audio flows to listener |
| Listener VU meter shows activity | VU driven by real stream |
| Volume slider at 0 → audio silent on page (but stream still active) | Volume is client-side gain |
| Translator ends session → listener sees "session ended" | End propagation works |
| Open 3 listener tabs → all receive audio, server reports 3 listeners | Fan-out is real |

### Phase 5 Validation

**What could be faked**: ABC binary compiles but doesn't run real WebRTC, audio capture is silent, headless mode masks broken code.

Since Phase 5 is hardware-dependent for full validation, e2e tests focus on the headless mode (which already exercises the real code path minus ALSA and display). The distinction between Phase 2 and Phase 5 tests is that Phase 5 tests run the actual `streamlate-abc` binary in a container rather than a test harness.

```
e2e/tests/phase-5/
  ├── abc-lifecycle.spec.ts
  └── abc-resilience.spec.ts
```

| Test | Validates |
|------|-----------|
| ABC container starts, registers with server, appears online | Real binary works end-to-end |
| Start session → translator hears 440 Hz sine from ABC container | ABC's WebRTC + Opus pipeline works |
| Translator sends 880 Hz → ABC container's verification endpoint reports 880 Hz | ABC receives and decodes audio |
| Stop server → ABC retries → restart server → ABC reconnects | Reconnection logic in real binary |
| Network partition (Docker network disconnect) → ABC recovers | Resilience in real conditions |

### Phase 6 Validation

**What could be faked**: Recording files are empty/zero-length, playback UI shows a player but it doesn't sync, crash recovery doesn't actually recover.

```
e2e/tests/phase-6/
  ├── recording.spec.ts
  ├── crash-recovery.spec.ts
  └── playback.spec.ts
```

| Test | Validates |
|------|-----------|
| After session, recording appears in API with non-zero duration | Recording was created |
| Download source.ogg → file is valid Ogg/Opus, duration ≥ session duration - 2s | Real audio recorded |
| Download translation.ogg → same validation | Both tracks recorded |
| Decode source.ogg → detect 440 Hz | Recorded audio contains the right content |
| Decode translation.ogg → detect 880 Hz | Both tracks have correct content |
| **Kill server mid-session (SIGKILL)**, restart → recording exists with partial duration | Crash recovery works |
| Recovered recording .ogg files are valid and playable | Files aren't corrupted |
| Playback UI: play recording → source and translation play | Playback wired to real files |
| Playback UI: seek to middle → both tracks seek | Sync is real |
| Mute event at T=10s → metadata.json contains mute event near T=10s | Events are recorded |

The **SIGKILL test** is non-negotiable. It proves crash resilience isn't aspirational.

### Phase 7 Validation

**What could be faked**: Admin forms render but don't submit, QR codes are placeholder images, settings don't persist.

```
e2e/tests/phase-7/
  ├── admin-users.spec.ts
  ├── admin-abcs.spec.ts
  ├── admin-sessions.spec.ts
  ├── admin-recordings.spec.ts
  ├── qr-codes.spec.ts
  └── theme.spec.ts
```

| Test | Validates |
|------|-----------|
| Admin creates user in UI → user can log in | User creation is wired end-to-end |
| Admin deletes user → user cannot log in | Deletion is real |
| Admin registers ABC in UI → ABC sim can connect with shown credentials | ABC registration UI works |
| Admin rotates ABC secret → old secret rejected, new secret works | Secret rotation is real |
| Admin force-stops session → translator and listener see session end | Force-stop reaches all participants |
| Admin deletes recording → API returns 404 for it | Deletion is real |
| QR code on session screen → decode QR → URL matches `/listen/{session_id}` | QR encodes correct URL |
| Scan QR URL in new browser context → listener connects and hears audio | QR → listener flow works end-to-end |
| Toggle theme to light → reload → theme persists | Theme preference persisted |
| Non-admin user cannot access `/admin` routes | Role gate is enforced |

### Phase 8 Validation

**What could be faked**: Security headers claimed but not sent, metrics endpoint exists but returns static values.

```
e2e/tests/phase-8/
  ├── security.spec.ts
  ├── monitoring.spec.ts
  └── full-workflow.spec.ts
```

| Test | Validates |
|------|-----------|
| Response headers include CSP, X-Frame-Options, HSTS | Security headers sent |
| SQL injection attempt in user creation → rejected (not 500) | Input sanitized |
| Path traversal in recording download → 400/404 (not file contents) | Path traversal blocked |
| Health check with stopped DB → degraded status | Health check probes real subsystems |
| Metrics endpoint returns counters that increase after requests | Metrics are live, not static |
| **Full workflow**: bootstrap → create user → register ABC → ABC connects → start session → translator hears source → listener hears translation → mute → unmute → passthrough → end session → recording plays back with correct audio → delete recording | Everything works together |

## Running the Suite

```bash
# Full suite
cd e2e
docker compose up --build -d
npx playwright test
docker compose down

# Single phase
npx playwright test tests/phase-2/

# With UI (debugging)
npx playwright test --ui

# In CI
# See .github/workflows/e2e.yml
```

### CI Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker images
        run: docker compose -f e2e/docker-compose.yml build

      - name: Start stack
        run: docker compose -f e2e/docker-compose.yml up -d --wait

      - name: Install Playwright
        run: cd e2e && npm ci && npx playwright install chromium

      - name: Run E2E tests
        run: cd e2e && npx playwright test

      - name: Collect logs on failure
        if: failure()
        run: docker compose -f e2e/docker-compose.yml logs > e2e-logs.txt

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-failure-logs
          path: |
            e2e-logs.txt
            e2e/test-results/

      - name: Teardown
        if: always()
        run: docker compose -f e2e/docker-compose.yml down -v
```

## ABC Headless Mode

The `--headless` flag (behind `#[cfg(feature = "headless")]`) substitutes hardware I/O:

| Real Mode | Headless Mode |
|-----------|---------------|
| ALSA capture → Opus encode | Sine wave generator (440 Hz) → Opus encode |
| Opus decode → ALSA playback | Opus decode → ring buffer + HTTP verification endpoint |
| TFT display via SPI | No display (state logged to stdout) |
| Wi-Fi/Ethernet management | Container networking (already connected) |

The headless mode is **not a separate binary** — it's the same `streamlate-abc` binary compiled with `--features headless`. This ensures the test exercises the real code, not a parallel mock implementation.

### Verification Endpoint (Headless Only)

```
GET http://abc-sim:9090/audio/received
→ {
    "dominant_frequency_hz": 880.0,
    "rms_db": -12.3,
    "samples_received": 48000,
    "duration_seconds": 1.0
  }
```

Tests query this endpoint to verify the ABC is receiving real audio with the expected content.

## Anti-Fake-Progress Patterns

| Pattern | How Tests Catch It |
|---------|-------------------|
| CRUD returns hardcoded data | Restart server → data must survive |
| Auth accepts any password | Login with wrong password must fail |
| WebRTC "connects" without audio | Frequency detection proves real audio |
| Mute is a UI-only toggle | Listener audio level assertion |
| Recording files are empty | Download and validate Ogg/Opus + detect frequency |
| Crash recovery is aspirational | SIGKILL server, restart, verify recording |
| VU meters are CSS animations | Assert meter value correlates with audio presence |
| QR code is a placeholder | Decode QR, verify URL, follow it |
| Admin operations are display-only | Perform action in admin UI, verify effect via separate API call or separate user |
| Rate limiting is absent | Exceed limit, verify 429 |
| Health check is hardcoded "ok" | Stop DB, verify degraded |
