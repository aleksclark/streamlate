use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppError;
use crate::AppState;

#[derive(Serialize, ToSchema)]
pub struct RecordingResponse {
    pub id: String,
    pub session_id: String,
    pub source_path: String,
    pub translation_path: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct RecordingsListResponse {
    pub items: Vec<RecordingResponse>,
    pub total_size_bytes: i64,
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings",
    responses(
        (status = 200, description = "List recordings", body = RecordingsListResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_recordings(
    State(state): State<AppState>,
) -> Result<Json<RecordingsListResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, source_path, translation_path, duration_seconds, size_bytes, created_at
             FROM recordings ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let recordings = stmt
        .query_map([], |row| {
            Ok(RecordingResponse {
                id: row.get(0)?,
                session_id: row.get(1)?,
                source_path: row.get(2)?,
                translation_path: row.get(3)?,
                duration_seconds: row.get(4)?,
                size_bytes: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let total_size_bytes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM recordings",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(Json(RecordingsListResponse {
        items: recordings,
        total_size_bytes,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings/{id}",
    params(("id" = String, Path, description = "Recording ID")),
    responses(
        (status = 200, description = "Recording details", body = RecordingResponse),
        (status = 404, description = "Recording not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_recording(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RecordingResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let recording = conn
        .query_row(
            "SELECT id, session_id, source_path, translation_path, duration_seconds, size_bytes, created_at
             FROM recordings WHERE id = ?1",
            [&id],
            |row| {
                Ok(RecordingResponse {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    source_path: row.get(2)?,
                    translation_path: row.get(3)?,
                    duration_seconds: row.get(4)?,
                    size_bytes: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Recording '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    Ok(Json(recording))
}

#[utoipa::path(
    delete,
    path = "/api/v1/recordings/{id}",
    params(("id" = String, Path, description = "Recording ID")),
    responses(
        (status = 204, description = "Recording deleted"),
        (status = 404, description = "Recording not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_recording(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let paths: Option<(String, String, String)> = conn
        .query_row(
            "SELECT source_path, translation_path, metadata_path FROM recordings WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    let changed = conn
        .execute("DELETE FROM recordings WHERE id = ?1", [&id])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if changed == 0 {
        return Err(AppError::NotFound(format!("Recording '{}' not found", id)));
    }

    if let Some((source, translation, metadata)) = paths {
        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_file(&translation);
        let _ = std::fs::remove_file(&metadata);
    }

    Ok(StatusCode::NO_CONTENT)
}
