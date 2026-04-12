# API Design

The server exposes a RESTful JSON API under `/api/v1/`. An OpenAPI 3.1 specification is generated at build time and served at runtime.

## Conventions

| Concern | Convention |
|---------|-----------|
| Base path | `/api/v1` |
| Content type | `application/json` |
| Auth | `Authorization: Bearer <access_token>` (except public endpoints) |
| IDs | UUID v4 |
| Timestamps | ISO 8601 (UTC) |
| Pagination | Cursor-based: `?cursor=<id>&limit=50` |
| Errors | `{ "error": { "code": "...", "message": "..." } }` |
| Naming | snake_case for JSON fields |

## OpenAPI Generation

```
                  Rust source (utoipa derive macros)
                          │
                          ▼
               Build-time: generate openapi.json
                          │
                          ▼
               Runtime: GET /api/openapi.json
                          │
                          ▼
            Frontend: openapi-typescript-codegen
                          │
                          ▼
                Generated API client (TypeScript)
```

The OpenAPI spec is the single source of truth for the client-server contract.

## Endpoints

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | None | Authenticate, receive tokens |
| POST | `/auth/refresh` | Cookie | Rotate refresh token, get new access token |
| POST | `/auth/logout` | Cookie | Invalidate refresh token |
| GET | `/auth/me` | Bearer | Get current user info |

### Users (Admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List all users |
| POST | `/users` | Create user |
| GET | `/users/{id}` | Get user details |
| PUT | `/users/{id}` | Update user |
| DELETE | `/users/{id}` | Delete user |

### ABCs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/abcs` | Bearer | List all ABCs with status |
| POST | `/abcs` | Admin | Register new ABC (returns credentials) |
| GET | `/abcs/{id}` | Bearer | Get ABC details |
| PUT | `/abcs/{id}` | Admin | Update ABC name/config |
| DELETE | `/abcs/{id}` | Admin | Remove ABC |
| POST | `/abcs/{id}/rotate-secret` | Admin | Generate new API key |
| POST | `/abc/register` | ABC key | ABC self-registration (runtime) |

### Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sessions` | Bearer | List sessions (filter: active, completed, all) |
| POST | `/sessions` | Bearer | Create session (assign translator + ABC) |
| GET | `/sessions/{id}` | Bearer | Get session details |
| POST | `/sessions/{id}/stop` | Bearer | End session |
| POST | `/sessions/{id}/listen` | None/PIN | Request listener WebSocket URL |
| GET | `/sessions/{id}/health` | Bearer | Get session health metrics |

### Recordings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/recordings` | Bearer | List recordings |
| GET | `/recordings/{id}` | Bearer | Get recording metadata |
| GET | `/recordings/{id}/source` | Bearer | Download source audio file |
| GET | `/recordings/{id}/translation` | Bearer | Download translation audio file |
| DELETE | `/recordings/{id}` | Admin | Delete recording |

### System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/system/health` | None | Health check |
| GET | `/system/stats` | Admin | System statistics |

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `bad_request` | Invalid input |
| 401 | `unauthorized` | Missing or invalid token |
| 403 | `forbidden` | Insufficient permissions |
| 404 | `not_found` | Resource not found |
| 409 | `conflict` | Resource conflict (e.g., ABC already in session) |
| 422 | `validation_error` | Request body validation failed |
| 500 | `internal_error` | Unexpected server error |

Example error response:

```json
{
  "error": {
    "code": "conflict",
    "message": "ABC 'Main Hall — Booth A' is already assigned to an active session",
    "details": {
      "abc_id": "550e8400-...",
      "active_session_id": "7c9e6679-..."
    }
  }
}
```

## Request/Response Examples

### Create Session

```
POST /api/v1/sessions
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "abc_id": "550e8400-...",
  "session_name": "Main Hall — Spanish",
  "pin": "1234"           // optional, for listener access
}

→ 201 Created
{
  "id": "7c9e6679-...",
  "abc_id": "550e8400-...",
  "translator_id": "a1b2c3d4-...",
  "session_name": "Main Hall — Spanish",
  "state": "starting",
  "signaling_url": "wss://streamlate.example.com/ws/translate/7c9e6679-...",
  "created_at": "2025-01-15T10:30:00Z"
}
```

### List Active Sessions (Listener)

```
GET /api/v1/sessions?state=active

→ 200 OK
{
  "items": [
    {
      "id": "7c9e6679-...",
      "session_name": "Main Hall — Spanish",
      "translator_name": "Maria Rodriguez",
      "started_at": "2025-01-15T10:30:00Z",
      "listener_count": 12,
      "has_pin": true
    }
  ],
  "cursor": null
}
```

## Rate Limiting

| Endpoint Group | Limit |
|----------------|-------|
| `/auth/login` | 10 requests / minute / IP |
| `/auth/refresh` | 30 requests / minute / IP |
| All other authenticated | 120 requests / minute / user |
| Listener endpoints | 60 requests / minute / IP |
