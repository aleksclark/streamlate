# Server

The server is the central hub of Streamlate. It acts as a WebRTC Selective Forwarding Unit (SFU) for audio, manages sessions between ABCs and translators, serves the REST API, handles authentication, and records sessions.

## Responsibilities

1. **WebRTC SFU** — Relay audio tracks between ABCs, translators, and listeners without transcoding
2. **Session Management** — Create, track, and tear down translation sessions
3. **ABC Registry** — Track connected booth connectors and their status
4. **User Management** — Admin and translator accounts
5. **REST API** — CRUD for all managed entities, OpenAPI spec generation
6. **Recording** — Stream session audio to disk in crash-resilient format
7. **Listener Distribution** — Fan out translated audio to any number of web listeners

## Technology

| Concern | Choice |
|---------|--------|
| Language | Rust |
| HTTP framework | `axum` |
| WebRTC | `webrtc-rs` |
| Database | SQLite via `rusqlite` (WAL mode) |
| OpenAPI | `utoipa` (derive macros → OpenAPI 3.1 JSON at `/api/openapi.json`) |
| Auth | JWT (access + refresh tokens) |
| WebSocket | `axum` built-in + `tokio-tungstenite` |
| Async runtime | `tokio` |
| Config | `config` crate, TOML file + env overrides |

## Architecture

```
                          ┌───────────────────────────┐
                          │         axum HTTP          │
                          │  ┌─────────┐ ┌──────────┐ │
    REST clients ────────►│  │ REST API│ │ OpenAPI  │ │
                          │  └─────────┘ └──────────┘ │
                          │  ┌─────────────────────┐   │
    ABCs ────────────────►│  │ Signaling WebSocket │   │
    Translators ─────────►│  │   (per-connection)  │   │
                          │  └────────┬────────────┘   │
                          │           │                 │
                          │  ┌────────▼────────────┐   │
                          │  │   Session Manager    │   │
                          │  │  ┌───────────────┐  │   │
                          │  │  │  WebRTC SFU    │  │   │
                          │  │  │  (per-session) │  │   │
                          │  │  └───────────────┘  │   │
                          │  │  ┌───────────────┐  │   │
                          │  │  │  Recorder      │  │   │
                          │  │  │  (per-session) │  │   │
                          │  │  └───────────────┘  │   │
                          │  └─────────────────────┘   │
                          │  ┌─────────────────────┐   │
                          │  │    SQLite (WAL)      │   │
                          │  └─────────────────────┘   │
                          └───────────────────────────┘
```

## Session Lifecycle

```
1. ABC connects → registers → enters "idle" pool
2. Translator opens Translation Client → authenticates → sees idle ABCs
3. Translator selects ABC → POST /api/v1/sessions
4. Server creates session record (state: "starting")
5. Server signals ABC via WebSocket: "start session"
6. ABC and Server negotiate WebRTC (ICE, DTLS, SRTP)
7. Translator and Server negotiate WebRTC
8. Server bridges audio:
     ABC source track ──► Translator (incoming audio)
     Translator track  ──► ABC (translated playback)
     Translator track  ──► Listeners (fan-out)
9. Session state → "active", recording begins
10. Translator or admin ends session → POST /api/v1/sessions/{id}/stop
11. Server tears down WebRTC, finalizes recording
12. Session state → "completed"
```

## Session States

| State | Description |
|-------|-------------|
| `starting` | Session created, WebRTC negotiation in progress |
| `active` | Audio flowing, recording in progress |
| `paused` | Translator muted translated stream, source still forwarded to translator |
| `passthrough` | Original audio forwarded to listeners (e.g., during music) |
| `completed` | Session ended normally |
| `failed` | Session ended due to error |

## API Overview

Full API spec in [api.md](api.md). Key resource groups:

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/api/v1/auth` | Login, refresh, logout |
| Users | `/api/v1/users` | CRUD for admin/translator accounts |
| ABCs | `/api/v1/abcs` | Manage booth connectors |
| Sessions | `/api/v1/sessions` | Create, list, stop, query sessions |
| Recordings | `/api/v1/recordings` | List, download, delete recordings |
| Listeners | `/api/v1/sessions/{id}/listen` | WebSocket → WebRTC setup for listeners |
| System | `/api/v1/system` | Health check, stats |

## Configuration

```toml
# streamlate-server.toml

[server]
bind = "0.0.0.0:8443"
tls_cert = "/etc/streamlate/cert.pem"
tls_key = "/etc/streamlate/key.pem"

[database]
path = "/var/lib/streamlate/streamlate.db"

[auth]
jwt_secret = "..."          # or read from env: STREAMLATE_JWT_SECRET
access_token_ttl = "15m"
refresh_token_ttl = "7d"

[webrtc]
stun_servers = ["stun:stun.l.google.com:19302"]
turn_server = ""            # optional, for NAT traversal
turn_username = ""
turn_password = ""
port_range_min = 50000
port_range_max = 60000

[recording]
dir = "/var/lib/streamlate/recordings"
format = "ogg-opus"         # crash-resilient streaming format

[logging]
level = "info"              # trace, debug, info, warn, error
format = "json"             # json | pretty
```

## Concurrency Model

- One `tokio` task per WebSocket connection (ABC or translator signaling)
- One `tokio` task per WebRTC peer connection
- Session manager is an actor (receives messages via `tokio::mpsc`)
- Recorder runs as a background task per session, writes incrementally
- SQLite access serialized via a dedicated connection pool (1 writer, N readers via WAL)

## Error Handling

- All REST endpoints return structured error JSON: `{ "error": { "code": "...", "message": "..." } }`
- WebSocket errors sent as JSON frames before close
- WebRTC connection failures trigger automatic retry from the ABC side
- Server never panics on user input — all handlers return `Result`

## Scalability Notes

For the initial deployment, a single server instance is sufficient. The architecture allows future scaling:

- **Horizontal SFU scaling**: Sessions can be sharded across SFU workers by session ID
- **Database**: SQLite is adequate for hundreds of concurrent sessions; migration path to PostgreSQL if needed
- **Recordings**: Can be offloaded to object storage (S3-compatible) with a storage adapter trait
