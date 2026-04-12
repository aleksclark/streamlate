# Phase 0: Project Scaffold

**Goal**: Monorepo structure with build tooling, shared types, CI, OpenAPI codegen pipeline, **Docker Compose e2e stack**, and **Playwright test harness**.

**Duration**: ~1 week

## Steps

### 0.1 Repository Structure

Create the directory layout:

```
streamlate/
├── AGENTS.md
├── CHOICES.md
├── ROADMAP.md
├── base_spec.md
├── docs/
├── plan/
├── Cargo.toml                  # Workspace root
├── crates/
│   ├── server/                 # streamlate-server binary
│   │   ├── Cargo.toml
│   │   └── src/
│   ├── abc/                    # streamlate-abc binary
│   │   ├── Cargo.toml
│   │   └── src/
│   └── common/                 # Shared Rust types (API models, etc.)
│       ├── Cargo.toml
│       └── src/
├── clients/
│   ├── translation/            # Vite + React SPA
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   ├── listener/               # Vite + React SPA
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   └── shared/                 # Shared TS components/hooks
│       ├── package.json
│       └── src/
├── e2e/
│   ├── docker-compose.yml
│   ├── docker/
│   │   ├── Dockerfile.server
│   │   ├── Dockerfile.translation-client
│   │   ├── Dockerfile.listener-client
│   │   ├── Dockerfile.abc-sim
│   │   └── nginx-spa.conf
│   ├── playwright.config.ts
│   ├── package.json
│   ├── fixtures/
│   │   ├── audio.ts
│   │   ├── api.ts
│   │   └── webrtc.ts
│   └── tests/
│       ├── phase-0/
│       ├── phase-1/
│       └── ...
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── e2e.yml
├── .gitignore
└── README.md
```

### 0.2 Rust Workspace

```toml
# Cargo.toml (workspace root)
[workspace]
members = ["crates/server", "crates/abc", "crates/common"]
resolver = "2"

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
thiserror = "2"
anyhow = "1"
```

### 0.3 Server Crate Skeleton

Minimal `main.rs` with:
- axum hello-world on port 8080
- tracing initialization
- Config loading stub
- Health check endpoint: `GET /api/v1/system/health`

Verify: `cargo run -p streamlate-server` starts and responds to health check.

### 0.4 ABC Crate Skeleton

Minimal `main.rs` with:
- Config loading from TOML
- tracing initialization
- Placeholder for main loop

Verify: `cargo build -p streamlate-abc` compiles (and cross-compiles for aarch64).

### 0.5 Common Crate

Define shared types:
- API error types
- UUID/timestamp wrappers
- Session state enum
- Role enum

### 0.6 Frontend Projects

Initialize both Vite + React + TypeScript projects:

```bash
cd clients/translation && npm create vite@latest . -- --template react-ts
cd clients/listener && npm create vite@latest . -- --template react-ts
```

Install shared dependencies:
- `tailwindcss`, `@tailwindcss/vite`
- shadcn/ui setup
- `zustand`
- `react-router-dom`

Create `clients/shared/` with:
- Shared Tailwind config
- Audio components (VU meter, volume slider) — stubs
- WebRTC hook stubs

### 0.7 OpenAPI Codegen Pipeline

1. Server generates `openapi.json` at build time (or via a `--export-openapi` CLI flag)
2. Script runs `openapi-typescript-codegen` to generate TypeScript client
3. Generated client placed in `clients/shared/src/api/generated/`
4. Both web clients import from shared

```bash
# scripts/codegen.sh
cargo run -p streamlate-server -- --export-openapi > openapi.json
npx openapi-typescript-codegen --input openapi.json --output clients/shared/src/api/generated
```

### 0.8 Docker Compose E2E Stack

Create the e2e test infrastructure (see [docs/e2e-testing.md](../docs/e2e-testing.md) for full spec):

1. **Dockerfiles** for each component:
   - `Dockerfile.server` — multi-stage build: compile Rust, copy binary to slim Debian
   - `Dockerfile.translation-client` — build Vite, serve from nginx
   - `Dockerfile.listener-client` — same pattern
   - `Dockerfile.abc-sim` — compile ABC binary with `--features headless`
   - `nginx-spa.conf` — SPA-friendly nginx config (try_files → index.html)

2. **docker-compose.yml** with:
   - `server` service (port 8080, health check)
   - `translation-client` (port 3001)
   - `listener-client` (port 3002)
   - `abc-sim` (depends on server, starts only when tests configure it)
   - All services on a shared Docker network

3. **Playwright project**:
   - `e2e/package.json` with Playwright, TypeScript
   - `e2e/playwright.config.ts` pointing at Docker services
   - `e2e/fixtures/api.ts` — REST API helper class
   - `e2e/fixtures/audio.ts` — sine wave injection and frequency detection via Web Audio API
   - `e2e/fixtures/webrtc.ts` — WebRTC connection state assertions

Verify: `docker compose up --build` starts all services. `npx playwright test tests/phase-0/` passes.

### 0.9 CI Pipeline

GitHub Actions workflow:

```yaml
# .github/workflows/ci.yml
jobs:
  rust:
    - cargo fmt --check
    - cargo clippy -- -D warnings
    - cargo test
    - cargo build --release

  frontend:
    - npm ci (in each client)
    - npm run lint
    - npm run typecheck
    - npm run build

  codegen:
    - Run codegen script
    - Verify no diff (generated code is committed)
```

### 0.10 E2E CI Pipeline

GitHub Actions workflow for e2e tests:

```yaml
# .github/workflows/e2e.yml
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

### 0.11 Cross-Compilation Setup

Document and test cross-compiling the ABC crate for `aarch64-unknown-linux-gnu`:

```bash
rustup target add aarch64-unknown-linux-gnu
cargo build -p streamlate-abc --target aarch64-unknown-linux-gnu
```

May need `cross` tool or a Docker-based cross-compile environment.

## Definition of Done

- [ ] `cargo build --workspace` succeeds
- [ ] `cargo test --workspace` succeeds (even if tests are trivial)
- [ ] Both frontend projects build (`npm run build`)
- [ ] Health check endpoint responds
- [ ] OpenAPI codegen script produces TypeScript client
- [ ] CI pipeline passes
- [ ] Cross-compile for aarch64 works (or is documented as blocked)
- [ ] `docker compose up --build` starts all services
- [ ] Playwright test harness runs and phase-0 smoke tests pass

## Validation Gate: E2E Tests

These tests must pass against the Docker stack before Phase 0 is complete:

```
e2e/tests/phase-0/smoke.spec.ts
```

| Test | What It Proves |
|------|----------------|
| Server health check returns 200 with JSON `{ status: "ok", version: "..." }` | Binary runs, isn't a stub |
| OpenAPI spec at `/api/openapi.json` parses as valid OpenAPI 3.x | Spec generation works |
| Translation client loads at `:3001`, renders without JS errors | Vite build produces working bundle |
| Listener client loads at `:3002`, renders without JS errors | Same |
| ABC sim container starts without crashing (exit code 0 or running) | ABC binary compiles and runs |
