use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppError;
use crate::AppState;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Serialize, ToSchema)]
pub struct SystemStatsResponse {
    pub uptime_seconds: u64,
    pub active_sessions: i64,
    pub connected_abcs: i64,
    pub total_users: i64,
    pub total_abcs: i64,
    pub total_sessions: i64,
    pub version: String,
}

static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

fn get_start_time() -> std::time::Instant {
    *START_TIME.get_or_init(std::time::Instant::now)
}

#[utoipa::path(
    get,
    path = "/api/v1/system/health",
    responses(
        (status = 200, description = "Server is healthy", body = HealthResponse)
    )
)]
pub async fn health(State(_state): State<AppState>) -> Json<HealthResponse> {
    get_start_time();
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/system/stats",
    responses(
        (status = 200, description = "System statistics", body = SystemStatsResponse)
    ),
    security(("bearer_auth" = []))
)]
pub async fn stats(
    State(state): State<AppState>,
) -> Result<Json<SystemStatsResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let total_users: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .unwrap_or(0);

    let total_abcs: i64 = conn
        .query_row("SELECT COUNT(*) FROM abcs", [], |row| row.get(0))
        .unwrap_or(0);

    let total_sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap_or(0);

    let active_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE state IN ('starting', 'active', 'paused', 'passthrough')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let connected_abcs = state.session_manager.get_connected_abc_count().await;

    let uptime = get_start_time().elapsed().as_secs();

    Ok(Json(SystemStatsResponse {
        uptime_seconds: uptime,
        active_sessions,
        connected_abcs: connected_abcs as i64,
        total_users,
        total_abcs,
        total_sessions,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }))
}
