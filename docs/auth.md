# Authentication & Authorization

## User Model

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `email` | String | Unique, used for login |
| `password_hash` | String | Argon2id hash |
| `display_name` | String | Shown in sessions |
| `role` | Enum | `admin` or `translator` |
| `created_at` | Timestamp | |
| `updated_at` | Timestamp | |

## Roles & Permissions

| Action | Admin | Translator |
|--------|:-----:|:----------:|
| Create/manage users | ✓ | — |
| Manage ABCs | ✓ | — |
| Delete recordings | ✓ | — |
| Force-stop any session | ✓ | — |
| Start/stop own sessions | ✓ | ✓ |
| View available ABCs | ✓ | ✓ |
| View active sessions | ✓ | ✓ |
| Play back recordings | ✓ | ✓ |
| Manage system settings | ✓ | — |

## Authentication Flow

### Login

```
POST /api/v1/auth/login
{
  "email": "maria@example.com",
  "password": "..."
}

→ 200 OK
{
  "access_token": "eyJ...",
  "expires_in": 900,
  "user": { "id": "...", "email": "...", "display_name": "...", "role": "translator" }
}
+ Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh
```

### Token Refresh

```
POST /api/v1/auth/refresh
Cookie: refresh_token=...

→ 200 OK
{
  "access_token": "eyJ...",
  "expires_in": 900
}
+ Set-Cookie: refresh_token=...; (rotated)
```

### Logout

```
POST /api/v1/auth/logout
Cookie: refresh_token=...

→ 204 No Content
+ Set-Cookie: refresh_token=; Max-Age=0
```

## Token Details

| Token | Type | Lifetime | Storage | Contains |
|-------|------|----------|---------|----------|
| Access | JWT (HS256) | 15 min | In-memory (JS variable) | `sub` (user ID), `role`, `exp`, `iat` |
| Refresh | Opaque (random 256-bit) | 7 days | httpOnly cookie | Mapped to user ID in DB |

- Access tokens are short-lived and stateless — the server validates signature and expiry only.
- Refresh tokens are stored in the database and can be individually revoked.
- On each refresh, the old refresh token is invalidated and a new one is issued (rotation).

## ABC Authentication

ABCs don't use the user auth system. They authenticate with a pre-shared API key:

```
POST /api/v1/abc/register
{
  "abc_id": "550e8400-...",
  "abc_secret": "sk_abc_..."
}

→ 200 OK
{
  "signaling_url": "wss://streamlate.example.com/ws/abc/550e8400-..."
}
```

ABC credentials are generated when an admin registers a new ABC in the management UI. The `abc_secret` is shown once and should be stored in the ABC's config file.

## WebSocket Authentication

WebSocket connections (signaling) carry the auth token as a query parameter:

```
wss://streamlate.example.com/ws/translate?token=eyJ...
wss://streamlate.example.com/ws/abc/{abc_id}?token=sk_abc_...
wss://streamlate.example.com/ws/listen/{session_id}?pin=1234  (optional PIN)
```

The server validates the token on WebSocket upgrade. Invalid tokens receive a 401 before the upgrade completes.

## Listener Authentication

Listeners do not need accounts. Access is granted by knowing the session ID (and optional PIN). This is intentional — the listener client should be frictionless for conference attendees.

## Password Policy

- Minimum 8 characters
- Argon2id with recommended parameters (m=19456, t=2, p=1)
- No password reuse enforcement (low-complexity deployment)

## First-Run Bootstrap

On first startup with an empty database, the server creates a default admin account:

```
Email: admin@streamlate.local
Password: (randomly generated, printed to stdout on first run)
```

The admin should change this password immediately after first login.
