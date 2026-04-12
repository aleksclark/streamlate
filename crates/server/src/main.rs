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
pub mod webrtc_peer;
pub mod session_manager;

use crate::config::AppConfig;
use crate::db::Database;
use crate::metrics::Metrics;
use crate::rate_limit::RateLimiter;
use crate::session_manager::SessionManager;
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

    let rate_limiter = Arc::new(RateLimiter::new());
    let session_manager = SessionManager::new(db.clone(), cfg.recording.clone());
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
