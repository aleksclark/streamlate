# Deployment & Operations

## Server Deployment

### Recommended Setup

| Component | Recommendation |
|-----------|---------------|
| Host | Single VPS or bare-metal server with a public IP |
| OS | Linux (Debian/Ubuntu LTS) |
| Reverse proxy | Caddy (auto TLS) or nginx |
| Process manager | systemd |
| TLS | Let's Encrypt via Caddy, or manual cert |
| Ports | 443 (HTTPS/WSS), 50000–60000 (UDP, WebRTC media) |

### Architecture

```
Internet
   │
   ├─ TCP 443 ──► Caddy (TLS termination)
   │                 ├─ /api/*  ──► streamlate-server :8080 (HTTP)
   │                 ├─ /ws/*   ──► streamlate-server :8080 (WebSocket)
   │                 └─ /*      ──► Static files (SPA bundles)
   │
   └─ UDP 50000-60000 ──► streamlate-server (WebRTC media, direct)
```

WebRTC media bypasses the reverse proxy — DTLS handles encryption directly.

### systemd Service

```ini
# /etc/systemd/system/streamlate-server.service
[Unit]
Description=Streamlate Translation Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=streamlate
Group=streamlate
ExecStart=/usr/local/bin/streamlate-server --config /etc/streamlate/server.toml
Restart=always
RestartSec=5
Environment=STREAMLATE_JWT_SECRET=file:/etc/streamlate/jwt_secret

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/streamlate
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Directory Layout

```
/usr/local/bin/streamlate-server        # Server binary
/etc/streamlate/
  ├── server.toml                       # Server config
  └── jwt_secret                        # JWT signing key
/var/lib/streamlate/
  ├── streamlate.db                     # SQLite database
  └── recordings/                       # Session recordings
/var/log/streamlate/                    # Log files (if not using journald)
```

## ABC Provisioning

### Factory Image

1. Build minimal Linux image with Buildroot (or customize Armbian)
2. Include `streamlate-abc` binary
3. Include systemd service for auto-start
4. Flash to eMMC via USB boot mode

### Per-Device Setup

1. Admin registers ABC in server UI → gets `abc_id` + `abc_secret`
2. Write `/etc/streamlate/abc.toml` to device (via SSH, SD card, or provisioning USB)
3. Configure Wi-Fi credentials if needed
4. Power on — device auto-connects

### OTA Updates

Future capability:

1. Admin uploads new firmware bundle to server
2. Server pushes update notification to connected ABCs
3. ABC downloads bundle, verifies signature
4. Applies update on next reboot (A/B partition scheme)

## Web Client Deployment

Both web clients are static SPAs. Build and serve as static files:

```bash
# Translation Client
cd clients/translation
npm run build
# Output: dist/

# Listener Client
cd clients/listener
npm run build
# Output: dist/
```

Serve via the same reverse proxy as the server:

```
/                   → Translation Client (dist/)
/listen             → Listener Client (dist/)
/api/*              → Server
/ws/*               → Server
```

Or deploy to a CDN (Cloudflare Pages, Vercel, etc.) with API requests proxied to the server.

## Monitoring

### Health Check

```
GET /api/v1/system/health

→ 200 OK
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_seconds": 86400,
  "active_sessions": 3,
  "connected_abcs": 5,
  "connected_translators": 3,
  "active_listeners": 47
}
```

### Logging

- Structured JSON logs to stdout (captured by journald or Docker)
- Log levels: `trace`, `debug`, `info`, `warn`, `error`
- Key events logged at `info`: session start/stop, ABC connect/disconnect, auth events
- WebRTC stats logged at `debug` level

### Metrics (Future)

Prometheus endpoint at `/metrics` with:

- Active sessions gauge
- Connected clients gauge (by type)
- WebRTC packet loss histogram
- API request latency histogram
- Recording disk usage gauge

## Backup

| What | How | Frequency |
|------|-----|-----------|
| SQLite database | `sqlite3 .backup` to file, then rsync/S3 | Daily + before upgrades |
| Recordings | rsync to backup server or S3 sync | Daily |
| Configuration | Version-controlled (git) | On change |

## Firewall Rules

```
# Inbound
TCP 443     ALLOW   # HTTPS + WSS
TCP 22      ALLOW   # SSH (admin only, restrict by IP)
UDP 50000:60000 ALLOW # WebRTC media

# Outbound
ALL         ALLOW   # Needed for STUN/TURN, DNS, package updates
```
