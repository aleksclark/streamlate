pub mod bootstrap;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

#[derive(Clone)]
pub struct Database {
    pool: Pool<SqliteConnectionManager>,
}

const MIGRATIONS: &[(&str, &str)] = &[(
    "001_initial",
    include_str!("../../migrations/001_initial.sql"),
)];

impl Database {
    pub fn new(path: &str) -> anyhow::Result<Self> {
        if let Some(parent) = Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let manager = SqliteConnectionManager::file(path);
        let pool = Pool::builder().max_size(8).build(manager)?;

        {
            let conn = pool.get()?;
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA busy_timeout = 5000;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA cache_size = -8000;",
            )?;
        }

        Ok(Database { pool })
    }

    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, r2d2::Error> {
        self.pool.get()
    }

    pub fn run_migrations(&self) -> anyhow::Result<()> {
        let conn = self.conn().map_err(|e| anyhow::anyhow!(e))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )?;

        for (name, sql) in MIGRATIONS {
            let already_applied: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM _migrations WHERE name = ?1",
                [name],
                |row| row.get(0),
            )?;

            if !already_applied {
                tracing::info!("Applying migration: {}", name);
                conn.execute_batch(sql)?;
                conn.execute(
                    "INSERT INTO _migrations (name, applied_at) VALUES (?1, datetime('now'))",
                    [name],
                )?;
            }
        }

        Ok(())
    }
}
