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
    pub uptime_seconds: u64,
    pub checks: HealthChecks,
}

#[derive(Serialize, ToSchema)]
pub struct HealthChecks {
    pub database: String,
    pub recordings_dir: String,
}

#[derive(Serialize, ToSchema)]
pub struct SystemStatsResponse {
    pub uptime_seconds: u64,
    pub active_sessions: i64,
    pub connected_abcs: i64,
    pub total_users: i64,
    pub total_abcs: i64,
    pub total_sessions: i64,
    pub total_recordings: i64,
    pub version: String,
}

#[derive(Serialize, ToSchema)]
pub struct StatsResponse {
    pub active_sessions: i64,
    pub total_users: i64,
    pub total_abcs: i64,
    pub total_recordings: i64,
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
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let mut status = "ok".to_string();
    let mut checks = HealthChecks {
        database: "ok".to_string(),
        recordings_dir: "ok".to_string(),
    };

    match state.db.conn() {
        Ok(conn) => {
            if conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0)).is_err() {
                checks.database = "degraded".to_string();
                status = "degraded".to_string();
            }
        }
        Err(_) => {
            checks.database = "unavailable".to_string();
            status = "degraded".to_string();
        }
    }

    let recordings_dir = std::path::Path::new("recordings");
    if recordings_dir.exists() {
        let test_path = recordings_dir.join(".health_check");
        match std::fs::write(&test_path, b"ok") {
            Ok(_) => {
                let _ = std::fs::remove_file(&test_path);
            }
            Err(_) => {
                checks.recordings_dir = "not_writable".to_string();
                status = "degraded".to_string();
            }
        }
    } else {
        checks.recordings_dir = "missing".to_string();
    }

    let uptime = state.metrics.uptime_seconds();

    Json(HealthResponse {
        status,
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: uptime,
        checks,
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

    let total_recordings: i64 = conn
        .query_row("SELECT COUNT(*) FROM recordings", [], |row| row.get(0))
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
        total_recordings,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }))
}
