# Streamlate — System Specification

This directory contains the complete technical specification for Streamlate, organized by component and concern.

## How to Read

Start with the component you're interested in. Each document is self-contained but links to related specs where relevant.

## Components

- [Audio Booth Connector (ABC)](abc.md) — The physical device bridging analog audio and WebRTC
- [Server](server.md) — The central orchestration and media relay service
- [Translation Client](translation-client.md) — Web app for translators
- [Listener Client](listener-client.md) — Web app for listeners

## Cross-Cutting Specs

- [WebRTC Architecture](webrtc.md) — Signaling protocol, media topology, codec choices
- [Authentication & Authorization](auth.md) — User model, roles, token flow
- [API Design](api.md) — REST API structure, OpenAPI, codegen
- [Recording & Playback](recording.md) — Session recording format, crash resilience, playback
- [E2E Testing](e2e-testing.md) — Docker Compose / Playwright test harness, per-phase validation gates
- [Data Model](data-model.md) — SQLite schema, entities, relationships
- [Deployment & Operations](deployment.md) — Hosting, ABC provisioning, monitoring
