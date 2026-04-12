# Phase 8: Hardening & Deployment

**Goal**: Security audit, production deployment setup, monitoring, documentation, and ABC provisioning guide.

**Duration**: ~1 week

**Depends on**: All previous phases

## Steps

### 8.1 Security Audit

Review and harden:

- [ ] **Input validation**: All REST endpoints validate input (length limits, format checks, SQL injection prevention via parameterized queries)
- [ ] **Auth**: Token expiry enforced, refresh rotation works, revocation works
- [ ] **CORS**: Configure appropriate origins (server serves SPAs, so same-origin is ideal)
- [ ] **Headers**: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`
- [ ] **Rate limiting**: All endpoints protected, especially auth
- [ ] **WebSocket auth**: Validated before upgrade
- [ ] **SDP validation**: Server rejects unexpected tracks/codecs
- [ ] **File access**: Recording download endpoints don't allow path traversal
- [ ] **Secrets**: JWT secret, ABC secrets never logged. Env-var based secret injection.
- [ ] **Dependencies**: Run `cargo audit`, `npm audit`

### 8.2 Logging Improvements

- Structured JSON logging (already in place, verify completeness)
- Log key events at `info` level:
  - Server start/stop
  - User login/logout
  - Session start/stop
  - ABC connect/disconnect
  - Errors (all)
- Request logging middleware: method, path, status, duration
- Correlation IDs: attach request ID to all logs within a request
- Sensitive data scrubbing (no passwords, tokens in logs)

Verify: Logs are parseable, contain request IDs, don't leak secrets.

### 8.3 Monitoring Endpoint

Implement `/metrics` (Prometheus format) or enhance `/api/v1/system/stats`:

- `streamlate_active_sessions` (gauge)
- `streamlate_connected_abcs` (gauge)
- `streamlate_connected_translators` (gauge)
- `streamlate_active_listeners` (gauge)
- `streamlate_http_requests_total` (counter, by method/path/status)
- `streamlate_http_request_duration_seconds` (histogram)
- `streamlate_webrtc_packet_loss` (histogram, by session)
- `streamlate_recording_disk_bytes` (gauge)

Verify: Metrics endpoint responds with current values.

### 8.4 Health Check Enhancement

`GET /api/v1/system/health` should check:

- Database is accessible (simple query)
- Recording directory is writable
- WebRTC port range is available
- Return degraded status if any check fails

```json
{
  "status": "ok",           // or "degraded"
  "checks": {
    "database": "ok",
    "recordings_dir": "ok",
    "webrtc_ports": "ok"
  },
  "version": "0.1.0",
  "uptime_seconds": 86400
}
```

Verify: Health check returns correct status.

### 8.5 Deployment Automation

Create deployment scripts/docs:

#### Server

```bash
# scripts/deploy-server.sh
# 1. Build release binary
cargo build --release -p streamlate-server

# 2. Build web clients
cd clients/translation && npm run build
cd clients/listener && npm run build

# 3. Copy to server
scp target/release/streamlate-server server:/usr/local/bin/
scp -r clients/translation/dist/* server:/var/www/streamlate/
scp -r clients/listener/dist/* server:/var/www/streamlate/listen/

# 4. Restart service
ssh server 'sudo systemctl restart streamlate-server'
```

#### Caddy Config

```
# /etc/caddy/Caddyfile
streamlate.example.com {
    handle /api/* {
        reverse_proxy localhost:8080
    }
    handle /ws/* {
        reverse_proxy localhost:8080
    }
    handle /listen/* {
        root * /var/www/streamlate/listen
        try_files {path} /index.html
        file_server
    }
    handle {
        root * /var/www/streamlate
        try_files {path} /index.html
        file_server
    }
}
```

### 8.6 ABC Provisioning Guide

Document the full ABC setup process:

1. **Build the OS image**
   - Base: Armbian for K2B
   - Customize: install deps, add streamlate-abc binary, systemd service
   - Create flashable image

2. **Flash the device**
   - Write image to eMMC via USB
   - Or: SD card boot → install to eMMC

3. **Configure the device**
   - Register ABC in server admin UI
   - Copy credentials to `/etc/streamlate/abc.toml`
   - Configure Wi-Fi if needed

4. **Test**
   - Power on
   - Verify appears as "online" in admin
   - Start a test session

5. **Deploy**
   - Connect audio cables (line-in from booth mixer, line-out to translator headphones or PA)
   - Mount/place device
   - Power on

### 8.7 Backup & Recovery Docs

Document:
- SQLite backup procedure (`sqlite3 .backup`)
- Recording backup (rsync)
- Full disaster recovery (from backups to running system)
- Config backup (version control)

### 8.8 Full Workflow E2E Test

The capstone e2e test: a single test that exercises the entire system from bootstrap to playback. This replaces the manual test plan — if this test passes, the system works.

See the `full-workflow.spec.ts` test in the validation gate below.

### 8.9 README & User Docs

- Update root `README.md` with:
  - Project overview
  - Quick start guide
  - Link to full documentation
- Create `docs/user-guide.md` — how to use the translation and listener clients
- Create `docs/admin-guide.md` — system administration

### 8.10 Release

- Tag `v0.1.0`
- Build release artifacts:
  - `streamlate-server` binary (x86_64 Linux)
  - `streamlate-abc` binary (aarch64 Linux)
  - Web client bundles (static files)
  - ABC OS image
- Write release notes

## Definition of Done

- [ ] Security checklist complete
- [ ] Logging is structured and comprehensive
- [ ] Monitoring endpoint active
- [ ] Health check verifies all subsystems
- [ ] Deployment scripts work
- [ ] Caddy config serves everything correctly
- [ ] ABC provisioning guide written and tested
- [ ] Backup procedures documented
- [ ] Documentation complete
- [ ] v0.1.0 tagged and release artifacts built
- [ ] **E2E validation gate passes — including full workflow test** (see below)

## Validation Gate: E2E Tests

Phase 8 tests validate security hardening and run the capstone full-workflow test that exercises every component.

```
e2e/tests/phase-8/
  ├── security.spec.ts
  ├── monitoring.spec.ts
  └── full-workflow.spec.ts
```

| Test | What It Proves |
|------|----------------|
| Response headers include `Content-Security-Policy`, `X-Frame-Options`, `HSTS` | Security headers actually sent |
| SQL injection in user creation body → 400/422 (not 500) | Input sanitized, not passed raw |
| Path traversal in recording download (`../../../etc/passwd`) → 400/404 | File access restricted |
| Health check with DB file removed → `degraded` status | Health check probes real subsystems |
| Metrics/stats endpoint returns values that increase after requests | Metrics are live, not static |
| **Full workflow test** (see below) | Everything works together end-to-end |

### Full Workflow Test (`full-workflow.spec.ts`)

A single test that exercises the entire system in sequence:

1. Server starts fresh (empty DB) → bootstrap admin credentials in logs
2. Login as admin with bootstrap credentials
3. Create translator user via admin API
4. Register ABC via admin API → get credentials
5. Start ABC sim container with credentials → verify it appears online
6. Login as translator in Playwright browser
7. Start session with the ABC from translator UI
8. Verify translator receives 440 Hz (source from ABC)
9. Translator page injects 880 Hz
10. Open listener page → verify listener receives 880 Hz
11. Activate mute → verify listener goes silent
12. Deactivate mute → verify listener receives 880 Hz again
13. Activate passthrough → verify listener receives 440 Hz
14. Deactivate passthrough → verify listener receives 880 Hz
15. End session from translator UI
16. Verify recording appears in API with non-zero duration
17. Download `source.ogg` → verify 440 Hz content
18. Download `translation.ogg` → verify 880 Hz content
19. Verify `metadata.json` contains mute and passthrough events
20. Open playback UI → verify both tracks play
21. Delete recording → verify 404
22. **SIGKILL server** → restart → verify previously created user still exists

If this test passes, the system is not faking progress.
