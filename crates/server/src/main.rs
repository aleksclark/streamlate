mod config;
mod db;
mod error;
mod auth;
mod routes;
mod middleware;
mod rate_limit;
pub mod recording;
mod security;
mod metrics;
pub mod signaling;
pub mod sfu_loop;
pub mod session_manager;

use crate::config::AppConfig;
use crate::db::Database;
use crate::metrics::Metrics;
use crate::rate_limit::RateLimiter;
use crate::session_manager::SessionManager;
use crate::sfu_loop::SfuLoop;
use clap::Parser;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "streamlate-server", version)]
struct Cli {
    #[arg(long, default_value = "streamlate-server.toml")]
    config: String,

    #[arg(long)]
    export_openapi: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Arc<AppConfig>,
    pub rate_limiter: Arc<RateLimiter>,
    pub session_manager: SessionManager,
    pub metrics: Metrics,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    let cfg = AppConfig::load(&cli.config)?;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&cfg.logging.level));

    if cfg.logging.format == "json" {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .init();
    }

    if cli.export_openapi {
        let spec = routes::openapi_spec();
        println!("{}", spec.to_pretty_json().unwrap());
        return Ok(());
    }

    let db = Database::new(&cfg.database.path)?;
    db.run_migrations()?;

    db::bootstrap::maybe_create_admin(&db)?;

    // Clean up sessions that were active when the server last shut down.
    // The in-memory session manager is empty on startup, so these sessions
    // can never complete normally — mark them as failed.
    {
        let conn = db.conn().map_err(|e| anyhow::anyhow!(e))?;
        let now = chrono::Utc::now().to_rfc3339();
        let cleaned = conn.execute(
            "UPDATE sessions SET state = 'failed', ended_at = ?1 WHERE state IN ('starting', 'active', 'paused', 'passthrough')",
            rusqlite::params![now],
        )?;
        if cleaned > 0 {
            tracing::info!("Cleaned up {} stale sessions from previous run", cleaned);
        }
    }

    // Create the SFU loop and get command/event channels
    let (sfu, sfu_cmd_tx, sfu_event_rx) = SfuLoop::new();

    // Spawn the SFU loop. Because str0m's Rtc is !Send, we need a dedicated
    // single-threaded runtime with a LocalSet.
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build SFU runtime");
        let local = tokio::task::LocalSet::new();
        local.spawn_local(async move {
            if let Err(e) = sfu.run().await {
                tracing::error!("SFU loop error: {}", e);
            }
        });
        rt.block_on(local);
    });

    let rate_limiter = Arc::new(RateLimiter::new());
    let session_manager = SessionManager::new(
        db.clone(),
        cfg.recording.clone(),
        sfu_cmd_tx,
        sfu_event_rx,
    );
    let metrics = Metrics::new();

    let recording_path = std::path::Path::new(&cfg.recording.path);
    match recording::recovery::recover_incomplete_recordings(recording_path, &db) {
        Ok(n) if n > 0 => tracing::info!("Recovered {} incomplete recordings", n),
        Err(e) => tracing::error!("Failed to run recording recovery: {}", e),
        _ => {}
    }

    let state = AppState {
        db,
        config: Arc::new(cfg.clone()),
        rate_limiter,
        session_manager,
        metrics,
    };

    let app = routes::build_router(state.clone());

    let bind = &cfg.server.bind;
    tracing::info!("Starting server on {}", bind);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
