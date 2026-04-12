# Streamlate

**Simultaneous audio translation infrastructure.**

Streamlate connects physical audio booths to remote translators and listeners in real time using WebRTC. A translator hears the source feed from a booth, speaks their translation, and listeners anywhere on the network receive the translated audio with minimal latency.

## System Architecture

```
┌─────────────┐  WebRTC   ┌────────────┐  WebRTC   ┌─────────────────┐
│  Audio Booth │◄────────►│            │◄─────────►│ Translation     │
│  Connector   │          │   Server   │           │ Client (Web)    │
│  (SBC)       │          │            │           └─────────────────┘
└─────────────┘          │            │  WebRTC   ┌─────────────────┐
                          │            │◄─────────►│ Listener        │
                          └────────────┘           │ Client (Web)    │
                                                    └─────────────────┘
```

## Quick Start

### Prerequisites

- Rust stable toolchain (1.75+)
- Node.js 18+ and npm
- SQLite 3

### Build & Run

```bash
# Build the server
cargo build --release -p streamlate-server

# Build web clients
cd clients/translation && npm install && npm run build && cd ../..
cd clients/listener && npm install && npm run build && cd ../..

# Run the server
./target/release/streamlate-server --config deploy/streamlate-server.toml
```

On first run, the server creates an admin account and prints the credentials:

```
========================================
  FIRST RUN: Admin account created
  Email:    admin@streamlate.local
  Password: <generated>
========================================
```

### Configuration

Copy and edit the sample configuration:

```bash
cp deploy/streamlate-server.toml my-config.toml
# Edit my-config.toml — at minimum, change the jwt_secret
./target/release/streamlate-server --config my-config.toml
```

Environment variables override file settings (prefix: `STREAMLATE_`):

```bash
export STREAMLATE_JWT_SECRET="your-secret-here"
export STREAMLATE_BIND="0.0.0.0:8080"
export STREAMLATE_DB_PATH="./data/streamlate.db"
```

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/user-guide.md) | How to use Streamlate as a translator or listener |
| [Admin Guide](docs/admin-guide.md) | System administration, user management, monitoring |
| [ABC Provisioning](docs/abc-provisioning.md) | Setting up Audio Booth Connector devices |
| [Backup & Recovery](docs/backup-recovery.md) | Backup procedures and disaster recovery |
| [Deployment](docs/deployment.md) | Production deployment guide |
| [API Specification](docs/api.md) | REST API documentation |
| [System Spec](docs/README.md) | Full system specification |
| [Technical Choices](CHOICES.md) | Rationale for technology decisions |

## Components

| Component | Description |
|-----------|-------------|
| **Server** (`crates/server`) | Rust — REST API, WebRTC SFU, session management, recording |
| **ABC** (`crates/abc`) | Rust — Audio Booth Connector for SBC hardware |
| **Translation Client** (`clients/translation`) | React + TypeScript — Translator web interface |
| **Listener Client** (`clients/listener`) | React + TypeScript — Listener web interface |
| **Shared** (`clients/shared`) | TypeScript — Shared client types and utilities |

## Deployment

For production deployment:

```bash
# Build everything and deploy
scripts/deploy-server.sh --target user@server

# Or build only
scripts/deploy-server.sh --build-only
```

See `deploy/` for:
- `Caddyfile` — Reverse proxy with automatic TLS
- `streamlate-server.service` — systemd unit file
- `streamlate-server.toml` — Production config template

## Monitoring

- **Health**: `GET /api/v1/system/health` — DB, recordings dir checks
- **Stats**: `GET /api/v1/system/stats` — Active sessions, users, ABCs
- **Metrics**: `GET /metrics` — Prometheus-format metrics

## API

The OpenAPI spec is available at runtime: `GET /api/openapi.json`

## Testing

E2E tests use Playwright against Docker Compose–deployed artifacts:

```bash
cd e2e
npm install
npx playwright test --project=phase-8
```

## Technology Stack

- **Server**: Rust, axum, SQLite (WAL), WebRTC (webrtc-rs)
- **Clients**: TypeScript, React, Vite, Zustand, shadcn/ui
- **Audio**: Opus codec, 48 kHz mono, WebRTC transport
- **Auth**: JWT access tokens + refresh token rotation
- **Deployment**: systemd, Caddy, Docker Compose (for testing)

## License

Copyright © 2024 Streamlate contributors. All rights reserved.
