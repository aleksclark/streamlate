use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppError;
use crate::AppState;

#[derive(Serialize, ToSchema)]
pub struct SessionHealthResponse {
    pub session_id: String,
    pub latency_ms: f64,
    pub packet_loss: f64,
    pub jitter_ms: f64,
    pub bitrate_kbps: f64,
}

pub async fn get_session_health(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SessionHealthResponse>, AppError> {
    let stats = state
        .session_manager
        .get_health_stats(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Session not found or not active".to_string()))?;

    Ok(Json(SessionHealthResponse {
        session_id: id,
        latency_ms: stats.latency_ms,
        packet_loss: stats.packet_loss,
        jitter_ms: stats.jitter_ms,
        bitrate_kbps: stats.bitrate_kbps,
    }))
}

pub async fn get_abc_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let online = state.session_manager.get_abc_status(&id).await;
    Ok(Json(serde_json::json!({
        "abc_id": id,
        "online": online
    })))
}
