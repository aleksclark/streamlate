# Data Model

SQLite database in WAL mode. Schema managed via embedded migrations (run on startup).

## Entity Relationship

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  users   │───1:N─│   sessions   │───N:1─│   abcs   │
└──────────┘       └──────────────┘       └──────────┘
                          │
                         1:1
                          │
                   ┌──────────────┐
                   │  recordings  │
                   └──────────────┘

┌──────────────────┐
│  refresh_tokens  │───N:1─── users
└──────────────────┘
```

## Tables

### users

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PRIMARY KEY | |
| `email` | TEXT | UNIQUE NOT NULL | |
| `password_hash` | TEXT | NOT NULL | Argon2id |
| `display_name` | TEXT | NOT NULL | |
| `role` | TEXT | NOT NULL | `admin` or `translator` |
| `created_at` | TEXT (ISO 8601) | NOT NULL | |
| `updated_at` | TEXT (ISO 8601) | NOT NULL | |

### abcs

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PRIMARY KEY | |
| `name` | TEXT | NOT NULL | Human-readable name |
| `secret_hash` | TEXT | NOT NULL | Argon2id hash of API key |
| `created_at` | TEXT (ISO 8601) | NOT NULL | |
| `updated_at` | TEXT (ISO 8601) | NOT NULL | |

Note: ABC online/offline/in-session status is tracked in memory, not in the database. The database stores only the registered identity.

### sessions

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PRIMARY KEY | |
| `abc_id` | TEXT (UUID) | FK → abcs(id) NOT NULL | |
| `translator_id` | TEXT (UUID) | FK → users(id) NOT NULL | |
| `session_name` | TEXT | NOT NULL | |
| `pin` | TEXT | NULLABLE | Optional listener PIN (plaintext, short-lived) |
| `state` | TEXT | NOT NULL | `starting`, `active`, `paused`, `passthrough`, `completed`, `failed` |
| `started_at` | TEXT (ISO 8601) | NOT NULL | |
| `ended_at` | TEXT (ISO 8601) | NULLABLE | |
| `created_at` | TEXT (ISO 8601) | NOT NULL | |

### recordings

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PRIMARY KEY | |
| `session_id` | TEXT (UUID) | FK → sessions(id) UNIQUE NOT NULL | 1:1 with session |
| `source_path` | TEXT | NOT NULL | Relative path to source .ogg |
| `translation_path` | TEXT | NOT NULL | Relative path to translation .ogg |
| `metadata_path` | TEXT | NOT NULL | Relative path to metadata.json |
| `duration_seconds` | REAL | NULLABLE | Set when session completes |
| `size_bytes` | INTEGER | NULLABLE | Total size of both audio files |
| `created_at` | TEXT (ISO 8601) | NOT NULL | |

### refresh_tokens

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PRIMARY KEY | |
| `user_id` | TEXT (UUID) | FK → users(id) NOT NULL | |
| `token_hash` | TEXT | UNIQUE NOT NULL | SHA-256 hash |
| `expires_at` | TEXT (ISO 8601) | NOT NULL | |
| `created_at` | TEXT (ISO 8601) | NOT NULL | |

## Indexes

```sql
CREATE INDEX idx_sessions_state ON sessions(state);
CREATE INDEX idx_sessions_abc_id ON sessions(abc_id);
CREATE INDEX idx_sessions_translator_id ON sessions(translator_id);
CREATE INDEX idx_recordings_session_id ON recordings(session_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

## Migration Strategy

- Migrations are embedded in the server binary as SQL files
- Run sequentially on startup (tracked via a `_migrations` table)
- Forward-only (no down migrations for simplicity)
- Each migration is a single transaction

```
migrations/
  001_initial.sql
  002_add_pin_to_sessions.sql
  ...
```

## SQLite Configuration

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -8000;  -- 8MB
```

WAL mode allows concurrent readers while a single writer operates, which fits the server's access pattern well.
