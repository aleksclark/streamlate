# Roadmap

Implementation plan for Streamlate, organized in phases that build on each other. Each phase produces a working (if incomplete) system that is **validated by black-box end-to-end tests** before being considered complete.

> **Anti-fake-progress rule**: No phase is done until its e2e test suite passes against Docker Compose–deployed built artifacts. See [docs/e2e-testing.md](docs/e2e-testing.md) for the full testing philosophy.

## Overview

| Phase | Name | Goal | Validation Gate | Details |
|-------|------|------|-----------------|---------|
| 0 | [Project Scaffold](plan/phase-0-scaffold.md) | Monorepo structure, build tooling, CI, **e2e harness** | Smoke tests pass against Docker stack | ~1 week |
| 1 | [Server Core](plan/phase-1-server-core.md) | REST API, auth, database, basic management | CRUD + auth + persistence-survives-restart | ~2 weeks |
| 2 | [WebRTC Foundation](plan/phase-2-webrtc.md) | Signaling, SFU, audio relay between peers | 440 Hz sine detected at translator, 880 Hz at listener | ~2 weeks |
| 3 | [Translation Client MVP](plan/phase-3-translation-client.md) | Translator can connect, hear source, send translation | Playwright drives real login → session → audio verified | ~2 weeks |
| 4 | [Listener Client MVP](plan/phase-4-listener-client.md) | Listeners can hear translated audio | Listener page receives 880 Hz, fan-out to 3 tabs verified | ~1 week |
| 5 | [ABC Software](plan/phase-5-abc.md) | ABC binary connects, captures/plays audio (headless) | ABC container's verification endpoint confirms received audio | ~1.5 weeks |
| 6 | [Recording & Playback](plan/phase-6-recording.md) | Session recording, crash recovery, playback UI | SIGKILL recovery test + frequency detection in downloaded .ogg | ~1.5 weeks |
| 7 | [Admin & Polish](plan/phase-7-admin-polish.md) | Admin panel, settings, QR codes, mobile polish | Admin creates user → user logs in; QR decoded → listener hears audio | ~1.5 weeks |
| 8 | [Hardening & Deploy](plan/phase-8-hardening.md) | Security audit, monitoring, deployment automation, docs | Security headers verified, full workflow test passes | ~1 week |

**Total estimated**: ~14 weeks for a solo developer (includes e2e harness setup), less with parallel frontend/backend work.

## Dependency Graph

```
Phase 0 ──► Phase 1 ──► Phase 2 ──┬──► Phase 3 ──► Phase 4
                                   │
                                   └──► Phase 5
                                   
Phase 3 + 4 ──► Phase 6
Phase 3 + 4 + 5 ──► Phase 7
All ──► Phase 8

E2E harness (Phase 0) is used by ALL subsequent phases.
```

Phases 3, 4, and 5 can be partially parallelized once Phase 2 is complete.

## Validation Gates

Every phase has a **validation gate** — a set of e2e tests that must pass against Docker Compose–deployed artifacts before the phase is marked complete. Tests are cumulative: Phase N's gate includes all tests from Phases 0–N.

| Gate | Key Proof | Catches |
|------|-----------|---------|
| Phase 0 | Docker stack starts, health check responds | Binaries that don't run |
| Phase 1 | Data survives server restart | In-memory-only persistence |
| Phase 2 | Frequency detection (440 Hz → 880 Hz) | WebRTC "connected" without real audio |
| Phase 3 | Playwright-driven session with VU meter assertions | UI that renders but doesn't function |
| Phase 4 | 3 concurrent listeners all receive audio | Fan-out that silently drops |
| Phase 5 | ABC binary's verification endpoint confirms received frequency | Headless mode masking broken code |
| Phase 6 | SIGKILL mid-session → recording recovered with correct audio | Aspirational crash recovery |
| Phase 7 | Admin action verified via separate API call | Display-only admin panel |
| Phase 8 | Full bootstrap-to-playback workflow in one test | Integration gaps |

## Milestones

| Milestone | Definition of Done | After Phase |
|-----------|-------------------|-------------|
| **M1: API Ready** | Server runs, auth works, CRUD survives restart. E2E: phase-1 suite green. | 1 |
| **M2: Audio Flows** | Real audio (verified by frequency) flows through SFU. E2E: phase-2 suite green. | 2 |
| **M3: Translation Works** | Translator hears source, listener hears translation — all via Playwright. E2E: phase-4 suite green. | 4 |
| **M4: ABC Binary Works** | ABC binary (headless) participates in real sessions. E2E: phase-5 suite green. | 5 |
| **M5: Recording** | Sessions recorded, crash-safe, playback works. E2E: phase-6 suite green (including SIGKILL). | 6 |
| **M6: Production Ready** | Full admin UI, QR codes, security hardened. E2E: full suite green. | 8 |

## Phase Summaries

### Phase 0: Project Scaffold
Set up the monorepo, Cargo workspace for Rust crates, Vite projects for web clients, shared types, CI pipeline, OpenAPI codegen workflow, **Docker Compose e2e stack**, and **Playwright test harness with audio verification fixtures**. The e2e infrastructure is built here and used by every subsequent phase.

### Phase 1: Server Core
Implement the REST API (axum), authentication (JWT + refresh tokens), SQLite database with migrations, user and ABC CRUD, and OpenAPI generation. **Validated by**: CRUD tests that restart the server container mid-suite to prove real persistence.

### Phase 2: WebRTC Foundation
Implement WebRTC signaling over WebSocket, SFU audio forwarding, and session lifecycle. ABC simulator sends 440 Hz; translator injects 880 Hz. **Validated by**: frequency detection proving real audio traverses the full pipeline.

### Phase 3: Translation Client MVP
Build the translation SPA: login, booth selection, session creation, WebRTC audio (incoming source + outgoing translation), VU meters, mute/passthrough controls. **Validated by**: Playwright drives the real UI, asserts VU meter values correlate with audio, mute produces silence.

### Phase 4: Listener Client MVP
Build the listener SPA: session picker, direct link, receive-only WebRTC, volume control, VU meter. **Validated by**: multiple Playwright browser contexts receiving audio simultaneously, PIN flow tested end-to-end.

### Phase 5: ABC Software
Implement the ABC Rust binary with headless mode: real WebRTC and Opus codec, synthetic audio source, verification sink. TFT display deferred to hardware-available phase. **Validated by**: ABC container's HTTP verification endpoint confirming received audio frequency.

### Phase 6: Recording & Playback
Add Ogg/Opus recording to the server, crash recovery, recording metadata, and synchronized playback UI in the translation client. **Validated by**: SIGKILL server mid-session, restart, download recovered .ogg, decode and detect correct frequencies.

### Phase 7: Admin & Polish
Full admin panel (users, ABCs, recordings, sessions, settings), QR code generation, mobile layout optimization, dark/light theme, recording management. **Validated by**: admin creates user in UI → user logs in via separate Playwright context; QR code decoded → URL followed → listener receives audio.

### Phase 8: Hardening & Deploy
Security audit, rate limiting, input validation, logging improvements, Prometheus metrics stub, deployment scripts (systemd, Caddy), ABC provisioning guide, end-to-end documentation. **Validated by**: full workflow test (bootstrap → translate → listen → record → playback) plus security header verification.

### Deferred: ABC TFT Display
The 2.4″ TFT display (ILI9341) is deferred until hardware is available. The ABC binary architecture supports pluggable display backends — headless mode is the default. See [plan/phase-5-abc.md](plan/phase-5-abc.md) for the display deferral plan.

---

See `plan/` directory for detailed step-by-step breakdowns of each phase.
See [docs/e2e-testing.md](docs/e2e-testing.md) for the complete e2e testing specification.
