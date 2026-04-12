# Streamlate

**Simultaneous audio translation infrastructure.**

Streamlate connects physical audio booths to remote translators and listeners in real time using WebRTC. A translator hears the source feed from a booth, speaks their translation, and listeners anywhere on the network receive the translated audio with minimal latency.

## System at a Glance

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

## Documentation Index

| Document | Description |
|----------|-------------|
| [Specification](docs/README.md) | Full system specification (start here for details) |
| [Technical Choices](CHOICES.md) | Rationale for every major technology and design decision |
| [Roadmap](ROADMAP.md) | Implementation plan with phases and milestones |
| [Base Spec](base_spec.md) | Original requirements document |

## Components

| Component | Summary | Spec |
|-----------|---------|------|
| **Audio Booth Connector (ABC)** | SBC device that bridges analog audio to/from the server over WebRTC | [docs/abc.md](docs/abc.md) |
| **Server** | Central hub: WebRTC SFU, session management, REST API, recording | [docs/server.md](docs/server.md) |
| **Translation Client** | Web SPA for translators to connect to booths and translate | [docs/translation-client.md](docs/translation-client.md) |
| **Listener Client** | Web SPA for audiences to listen to live translated audio | [docs/listener-client.md](docs/listener-client.md) |

## Cross-Cutting Concerns

| Topic | Document |
|-------|----------|
| WebRTC Signaling & Media | [docs/webrtc.md](docs/webrtc.md) |
| Authentication & Authorization | [docs/auth.md](docs/auth.md) |
| API Design | [docs/api.md](docs/api.md) |
| Recording & Playback | [docs/recording.md](docs/recording.md) |
| E2E Testing | [docs/e2e-testing.md](docs/e2e-testing.md) |
| Deployment & Operations | [docs/deployment.md](docs/deployment.md) |
| Data Model | [docs/data-model.md](docs/data-model.md) |

## Key Technical Choices

- **Rust** for server and ABC software
- **Vite + React + TypeScript** for web clients
- **WebRTC** for all real-time audio transport
- **SQLite** for persistence
- **OpenAPI** codegen for client-server contract

See [CHOICES.md](CHOICES.md) for full rationale.

## Validation

Every implementation phase is gated by **black-box e2e tests** that run against Docker Compose–deployed built artifacts. Tests use Playwright + frequency detection to prove real audio flows end-to-end. No phase is complete until its test suite passes.

See [docs/e2e-testing.md](docs/e2e-testing.md) for the full testing specification.
