# Phase 1: Server Core

**Goal**: REST API, authentication, database, CRUD for all entities, OpenAPI spec.

**Duration**: ~2 weeks

**Depends on**: Phase 0

## Steps

### 1.1 SQLite Setup

- Add `rusqlite` with WAL mode
- Create migration runner (embed SQL files, apply on startup)
- Write `001_initial.sql` migration:
  - `users` table
  - `abcs` table
  - `sessions` table
  - `recordings` table
  - `refresh_tokens` table
  - All indexes per [data-model.md](../docs/data-model.md)
- Create database connection pool (1 writer, N readers)

Verify: Server starts, creates database file, runs migration.

### 1.2 Configuration

- Implement config loading with `config` crate
- TOML file + environment variable overrides
- All config fields from [server.md](../docs/server.md) configuration section
- `--config` CLI flag for config file path
- `--export-openapi` CLI flag for codegen

Verify: Server loads config from file and env vars.

### 1.3 Error Handling Framework

- Define `AppError` enum (maps to HTTP status codes)
- Implement `IntoResponse` for axum
- Structured error JSON: `{ "error": { "code": "...", "message": "..." } }`
- Error codes from [api.md](../docs/api.md)

### 1.4 Authentication

- Implement Argon2id password hashing (via `argon2` crate)
- JWT access token generation and validation (`jsonwebtoken` crate)
- Refresh token generation, storage, rotation, revocation
- Login endpoint: `POST /api/v1/auth/login`
- Refresh endpoint: `POST /api/v1/auth/refresh`
- Logout endpoint: `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me` — current user info
- Auth middleware (axum extractor that validates Bearer token)
- Role-based authorization middleware

Verify: Can login, receive tokens, refresh, access protected endpoints, get rejected with invalid/expired tokens.

### 1.5 First-Run Bootstrap

- On startup, if `users` table is empty:
  - Generate random password
  - Create admin user (`admin@streamlate.local`)
  - Print credentials to stdout
- Only runs once (table check)

Verify: First run prints credentials, second run does not.

### 1.6 User CRUD (Admin Only)

- `GET /api/v1/users` — list users (paginated)
- `POST /api/v1/users` — create user
- `GET /api/v1/users/{id}` — get user
- `PUT /api/v1/users/{id}` — update user
- `DELETE /api/v1/users/{id}` — delete user
- Input validation (email format, password length, role enum)
- Admin-only authorization check

Verify: Full CRUD lifecycle via curl/httpie. Non-admin gets 403.

### 1.7 ABC CRUD (Admin Only)

- `GET /api/v1/abcs` — list ABCs (with in-memory status: online/offline/in-session)
- `POST /api/v1/abcs` — register new ABC (returns generated ID + secret, secret shown once)
- `GET /api/v1/abcs/{id}` — get ABC details
- `PUT /api/v1/abcs/{id}` — update ABC name
- `DELETE /api/v1/abcs/{id}` — remove ABC
- `POST /api/v1/abcs/{id}/rotate-secret` — regenerate API key
- ABC runtime registration: `POST /api/v1/abc/register` (ABC authenticates with its key)

Verify: Can register ABC, get credentials, use them to self-register at runtime.

### 1.8 Session CRUD

- `GET /api/v1/sessions` — list sessions (filter by state)
- `POST /api/v1/sessions` — create session (validates ABC is idle, translator is authenticated)
- `GET /api/v1/sessions/{id}` — get session details
- `POST /api/v1/sessions/{id}/stop` — end session
- Session state machine enforcement (only valid transitions)

Note: Sessions don't actually start audio yet — that's Phase 2. This phase sets up the data layer.

Verify: Can create session, query it, stop it. Invalid transitions rejected.

### 1.9 OpenAPI Generation

- Add `utoipa` derive macros to all request/response types and endpoints
- Generate OpenAPI 3.1 JSON
- Serve at `GET /api/openapi.json`
- Add `--export-openapi` flag that prints spec and exits

Verify: OpenAPI spec is valid (test with swagger-ui or openapi-lint). Codegen produces TypeScript client.

### 1.10 Rate Limiting

- Add rate limiting middleware (per IP and per user)
- Limits per [api.md](../docs/api.md) rate limiting section
- Use in-memory token bucket (no external store needed)

Verify: Exceeding rate limit returns 429.

## Definition of Done

- [ ] All CRUD endpoints work and are tested
- [ ] Auth flow complete (login, refresh, logout, role checks)
- [ ] First-run bootstrap creates admin
- [ ] OpenAPI spec generates and codegen works
- [ ] Rate limiting active
- [ ] Integration tests for all endpoints
- [ ] `cargo test` passes
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

These tests run against the Docker Compose stack. They interact only with the server's HTTP API — no source code access.

```
e2e/tests/phase-1/
  ├── bootstrap.spec.ts
  ├── auth.spec.ts
  ├── users.spec.ts
  ├── abcs.spec.ts
  └── sessions.spec.ts
```

| Test | What It Proves |
|------|----------------|
| First-run admin credentials appear in server container logs | Bootstrap is real |
| Login with correct password → 200 + tokens | Auth works |
| Login with wrong password → 401 | Password is actually verified, not a stub |
| Access protected endpoint without token → 401 | Auth middleware enforced |
| Access with expired token → 401 | Token expiry is real |
| Refresh → new access token works | Refresh flow works |
| Revoked refresh token → rejected | Revocation works |
| Create user → GET returns it with matching fields | CRUD is real persistence |
| Delete user → GET returns 404 | Delete actually deletes |
| Duplicate email → 409 | Unique constraint enforced |
| Non-admin creates user → 403 | Role check works |
| Register ABC → self-register with secret → 200 | ABC credential flow works |
| Self-register with wrong secret → 401 | Secret is validated |
| Create session with idle ABC → 201 | Session creation works |
| Create session with in-use ABC → 409 | State enforcement works |
| Exceed rate limit → 429 | Rate limiting is real |
| **Restart server container → previously created data still exists** | Persistence is SQLite on disk, not in-memory |

The **restart test** is the critical anti-fake-progress check for this phase.
