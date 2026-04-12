# Admin Guide

This guide covers system administration for a Streamlate deployment.

## Initial Setup

### First Run

On first startup with an empty database, the server creates a bootstrap admin account and prints the credentials to stdout and the log:

```
========================================
  FIRST RUN: Admin account created
  Email:    admin@streamlate.local
  Password: <generated-password>
========================================
```

**Save this password immediately** — it is shown only once. Use it to log in and create additional users.

### Changing the Default Admin Password

1. Log in with the bootstrap credentials
2. The admin can update their own password via the API or create a new admin user

### Configuration

The server reads configuration from a TOML file with environment variable overrides:

```toml
# /opt/streamlate/config/streamlate-server.toml

[server]
bind = "127.0.0.1:8080"

[database]
path = "/opt/streamlate/data/streamlate.db"

[auth]
jwt_secret = "your-very-long-random-secret"
access_token_ttl_seconds = 900       # 15 minutes
refresh_token_ttl_seconds = 604800   # 7 days

[logging]
level = "info"       # trace, debug, info, warn, error
format = "json"      # json or pretty
```

Environment variables override file values with the `STREAMLATE_` prefix:
- `STREAMLATE_BIND` → `server.bind`
- `STREAMLATE_DB_PATH` → `database.path`
- `STREAMLATE_JWT_SECRET` → `auth.jwt_secret`
- `STREAMLATE_LOG_LEVEL` → `logging.level`
- `STREAMLATE_LOG_FORMAT` → `logging.format`

## User Management

### Creating Users

```bash
curl -X POST https://streamlate.example.com/api/v1/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "translator1@example.com",
    "password": "secure-password-here",
    "display_name": "María García",
    "role": "translator"
  }'
```

Roles:
- `admin` — Full access to all management functions
- `translator` — Can create and manage translation sessions

### Listing Users

```bash
curl https://streamlate.example.com/api/v1/users \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Updating a User

```bash
curl -X PUT https://streamlate.example.com/api/v1/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

### Deleting a User

```bash
curl -X DELETE https://streamlate.example.com/api/v1/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## ABC Management

### Registering a New ABC

```bash
curl -X POST https://streamlate.example.com/api/v1/abcs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Booth 1 - Main Hall"}'
```

The response includes the ABC secret — **save it**, it's shown only once.

### Rotating an ABC Secret

If a secret is compromised:

```bash
curl -X POST https://streamlate.example.com/api/v1/abcs/$ABC_ID/rotate-secret \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Update the device's `/etc/streamlate/abc.toml` with the new secret.

### Checking ABC Status

```bash
curl https://streamlate.example.com/api/v1/abcs/$ABC_ID/status
```

Returns `{"abc_id": "...", "online": true/false}`.

## Session Management

### Listing Sessions

```bash
# All sessions
curl https://streamlate.example.com/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN"

# Only active sessions
curl "https://streamlate.example.com/api/v1/sessions?state=active" \
  -H "Authorization: Bearer $TOKEN"
```

### Stopping a Session

```bash
curl -X POST https://streamlate.example.com/api/v1/sessions/$SESSION_ID/stop \
  -H "Authorization: Bearer $TOKEN"
```

## Monitoring

### Health Check

```bash
curl https://streamlate.example.com/api/v1/system/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_seconds": 86400,
  "checks": {
    "database": "ok",
    "recordings_dir": "ok"
  }
}
```

Status values: `ok` (all checks pass), `degraded` (one or more checks failed).

### System Stats

```bash
curl https://streamlate.example.com/api/v1/system/stats
```

```json
{
  "active_sessions": 3,
  "total_users": 12,
  "total_abcs": 8,
  "total_recordings": 156
}
```

### Prometheus Metrics

The `/metrics` endpoint exposes Prometheus-format metrics:

```bash
curl https://streamlate.example.com/metrics
```

Exposed metrics:
- `streamlate_uptime_seconds` — Server uptime
- `streamlate_active_sessions` — Current active sessions
- `streamlate_connected_abcs` — Connected ABC devices
- `streamlate_active_listeners` — Active listeners
- `streamlate_http_requests_total` — HTTP request counts by method/path/status
- `streamlate_http_request_duration_milliseconds_sum` — Request duration totals
- `streamlate_recording_disk_bytes` — Total recording disk usage

### Logs

When running with systemd:

```bash
# Follow live logs
sudo journalctl -u streamlate-server -f

# Last 100 lines
sudo journalctl -u streamlate-server -n 100

# Logs since last hour
sudo journalctl -u streamlate-server --since "1 hour ago"
```

Structured JSON logs include:
- Request ID for correlating related log entries
- HTTP method, path, status, and duration for every request
- Session lifecycle events (start, stop, mute, passthrough)
- ABC connection/disconnection events
- Error details for debugging

## Security

### Security Headers

The server sets these security headers on all responses:
- `Content-Security-Policy` — Restricts content sources
- `X-Frame-Options: DENY` — Prevents iframe embedding
- `X-Content-Type-Options: nosniff` — Prevents MIME sniffing
- `Strict-Transport-Security` — Enforces HTTPS
- `Referrer-Policy` — Limits referrer information
- `Permissions-Policy` — Restricts browser features

### Rate Limiting

All endpoints are rate-limited:
- Login: 10 requests/minute
- Token refresh: 30 requests/minute
- General API: varies by endpoint

### JWT Security

- Access tokens expire after 15 minutes (configurable)
- Refresh tokens expire after 7 days (configurable)
- Refresh tokens are rotated on each use (old token invalidated)
- Tokens stored as httpOnly cookies (XSS-resistant)

### Best Practices

1. **Change the default JWT secret** — The default is insecure
2. **Use HTTPS** — Caddy handles this automatically
3. **Restrict metrics access** — The `/metrics` endpoint should only be accessible from your monitoring network
4. **Regular backups** — See [Backup & Recovery](backup-recovery.md)
5. **Keep software updated** — Monitor for security updates
6. **Rotate ABC secrets** if any device is lost or compromised

## Deployment

See also: [Deployment documentation](deployment.md)

### Directory Layout

```
/opt/streamlate/
├── bin/
│   └── streamlate-server     # Server binary
├── config/
│   └── streamlate-server.toml # Configuration
├── data/
│   ├── streamlate.db         # SQLite database
│   └── recordings/            # Session recordings
├── www/
│   ├── translation/           # Translation client SPA
│   └── listener/              # Listener client SPA
└── backups/
    └── db/                    # Database backups
```

### Upgrading

1. Build or download the new version
2. Back up the database: `sqlite3 /opt/streamlate/data/streamlate.db ".backup /opt/streamlate/backups/db/pre-upgrade.db"`
3. Replace the binary: `sudo cp streamlate-server /opt/streamlate/bin/`
4. Replace web clients: `sudo cp -r dist/* /opt/streamlate/www/`
5. Restart: `sudo systemctl restart streamlate-server`
6. Verify: `curl http://localhost:8080/api/v1/system/health`

### Rollback

If an upgrade fails:

1. Stop the server: `sudo systemctl stop streamlate-server`
2. Restore the old binary and web assets
3. Restore the database backup if needed
4. Start the server: `sudo systemctl start streamlate-server`

## API Reference

The full OpenAPI specification is available at:

```
https://streamlate.example.com/api/openapi.json
```

Import into Swagger UI or any OpenAPI-compatible tool for interactive API exploration.
