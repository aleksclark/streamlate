mod config;
mod db;
mod error;
mod auth;
mod routes;
mod middleware;
mod rate_limit;
pub mod signaling;
pub mod webrtc_peer;
pub mod session_manager;

use crate::config::AppConfig;
use crate::db::Database;
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
    let session_manager = SessionManager::new(db.clone());

    let state = AppState {
        db,
        config: Arc::new(cfg.clone()),
        rate_limiter,
        session_manager,
    };

    let app = routes::build_router(state.clone());

    let bind = &cfg.server.bind;
    tracing::info!("Starting server on {}", bind);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
