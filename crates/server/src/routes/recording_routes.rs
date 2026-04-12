use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::error::AppError;
use crate::AppState;

#[derive(Serialize, ToSchema)]
pub struct RecordingResponse {
    pub id: String,
    pub session_id: String,
    pub session_name: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: Option<i64>,
    pub state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct RecordingsListResponse {
    pub items: Vec<RecordingResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct RecordingMetadataResponse {
    pub id: String,
    pub session_id: String,
    pub session_name: String,
    pub translator_name: String,
    pub abc_name: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: Option<i64>,
    pub state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub events: Vec<RecordingEventResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct RecordingEventResponse {
    pub time: f64,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}

#[derive(Deserialize, IntoParams)]
pub struct RecordingsQuery {
    pub session_id: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Serialize, ToSchema)]
pub struct StorageStatsResponse {
    pub total_recordings: i64,
    pub total_size_bytes: i64,
    pub recording_path: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings",
    params(RecordingsQuery),
    responses(
        (status = 200, description = "List recordings", body = RecordingsListResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_recordings(
    State(state): State<AppState>,
    Query(query): Query<RecordingsQuery>,
) -> Result<Json<RecordingsListResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = query.limit.unwrap_or(50).min(100);
    let offset = query.offset.unwrap_or(0);

    let recordings = if let Some(session_id) = &query.session_id {
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.session_id, s.session_name, r.duration_seconds, r.size_bytes,
                        COALESCE(m.state, CASE WHEN s.state = 'completed' THEN 'completed' ELSE 'recording' END) as state,
                        s.started_at, s.ended_at, r.created_at
                 FROM recordings r
                 JOIN sessions s ON r.session_id = s.id
                 LEFT JOIN (SELECT session_id, 
                    CASE WHEN ended_at IS NOT NULL THEN 'completed' ELSE 'recording' END as state
                    FROM recordings) m ON m.session_id = r.session_id
                 WHERE r.session_id = ?1
                 ORDER BY r.created_at DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let rows = stmt
            .query_map(rusqlite::params![session_id, limit, offset], map_recording_row)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.session_id, s.session_name, r.duration_seconds, r.size_bytes,
                        CASE WHEN r.duration_seconds IS NOT NULL THEN 'completed' ELSE 'recording' END as state,
                        s.started_at, s.ended_at, r.created_at
                 FROM recordings r
                 JOIN sessions s ON r.session_id = s.id
                 ORDER BY r.created_at DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let rows = stmt
            .query_map(rusqlite::params![limit, offset], map_recording_row)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?
    };

    Ok(Json(RecordingsListResponse { items: recordings }))
}

fn map_recording_row(row: &rusqlite::Row) -> Result<RecordingResponse, rusqlite::Error> {
    Ok(RecordingResponse {
        id: row.get(0)?,
        session_id: row.get(1)?,
        session_name: row.get(2)?,
        duration_seconds: row.get(3)?,
        size_bytes: row.get(4)?,
        state: row.get(5)?,
        started_at: row.get(6)?,
        ended_at: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings/{id}",
    params(("id" = String, Path, description = "Recording ID")),
    responses(
        (status = 200, description = "Recording metadata", body = RecordingMetadataResponse),
        (status = 404, description = "Recording not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_recording(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RecordingMetadataResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let (metadata_path, rec_id, session_id, duration, size, _created_at): (String, String, String, Option<f64>, Option<i64>, String) = conn
        .query_row(
            "SELECT r.metadata_path, r.id, r.session_id, r.duration_seconds, r.size_bytes, r.created_at
             FROM recordings r WHERE r.id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Recording '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    let metadata_content = std::fs::read_to_string(&metadata_path)
        .map_err(|e| AppError::Internal(format!("Failed to read metadata: {}", e)))?;

    let metadata: crate::recording::metadata::RecordingMetadata =
        serde_json::from_str(&metadata_content)
            .map_err(|e| AppError::Internal(format!("Failed to parse metadata: {}", e)))?;

    let events = metadata
        .events
        .into_iter()
        .map(|e| RecordingEventResponse {
            time: e.time,
            event_type: e.event_type,
            value: e.value,
        })
        .collect();

    let state_str = match metadata.state {
        crate::recording::metadata::RecordingState::Recording => "recording",
        crate::recording::metadata::RecordingState::Completed => "completed",
        crate::recording::metadata::RecordingState::Failed => "failed",
    };

    Ok(Json(RecordingMetadataResponse {
        id: rec_id,
        session_id,
        session_name: metadata.session_name,
        translator_name: metadata.translator_name,
        abc_name: metadata.abc_name,
        duration_seconds: duration,
        size_bytes: size,
        state: state_str.to_string(),
        started_at: metadata.started_at,
        ended_at: metadata.ended_at,
        events,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings/{id}/source",
    params(("id" = String, Path, description = "Recording ID")),
    responses(
        (status = 200, description = "Source audio stream"),
        (status = 404, description = "Recording not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn stream_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    stream_file(state, &id, "source_path").await
}

#[utoipa::path(
    get,
    path = "/api/v1/recordings/{id}/translation",
    params(("id" = String, Path, description = "Recording ID")),
    responses(
        (status = 200, description = "Translation audio stream"),
        (status = 404, description = "Recording not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn stream_translation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    stream_file(state, &id, "translation_path").await
}

async fn stream_file(
    state: AppState,
    id: &str,
    path_column: &str,
) -> Result<impl IntoResponse, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let file_path: String = conn
        .query_row(
            &format!("SELECT {} FROM recordings WHERE id = ?1", path_column),
            [id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Recording '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to open file: {}", e)))?;

    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file metadata: {}", e)))?;

    Ok((
        StatusCode::OK,
        [
            ("content-type", "audio/ogg".to_string()),
            ("content-length", metadata.len().to_string()),
            (
                "content-disposition",
                format!("inline; filename=\"{}\"", 
                    std::path::Path::new(&file_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("audio.ogg")),
            ),
        ],
        body,
    ))
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

    let (source_path, translation_path, metadata_path): (String, String, String) = conn
        .query_row(
            "SELECT source_path, translation_path, metadata_path FROM recordings WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Recording '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    let _ = std::fs::remove_file(&source_path);
    let _ = std::fs::remove_file(&translation_path);
    let _ = std::fs::remove_file(&metadata_path);

    if let Some(parent) = std::path::Path::new(&source_path).parent() {
        let _ = std::fs::remove_dir(parent);
    }

    conn.execute("DELETE FROM recordings WHERE id = ?1", [&id])?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/system/storage",
    responses(
        (status = 200, description = "Storage statistics", body = StorageStatsResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn storage_stats(
    State(state): State<AppState>,
) -> Result<Json<StorageStatsResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let total_recordings: i64 = conn
        .query_row("SELECT COUNT(*) FROM recordings", [], |row| row.get(0))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let total_size_bytes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM recordings",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(StorageStatsResponse {
        total_recordings,
        total_size_bytes,
        recording_path: state.config.recording.path.clone(),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/recordings/bulk",
    request_body = BulkDeleteRequest,
    responses(
        (status = 200, description = "Bulk delete result", body = BulkDeleteResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn bulk_delete_recordings(
    State(state): State<AppState>,
    Json(body): Json<BulkDeleteRequest>,
) -> Result<Json<BulkDeleteResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut deleted = 0u32;

    for id in &body.ids {
        let result: Result<(String, String, String), _> = conn.query_row(
            "SELECT source_path, translation_path, metadata_path FROM recordings WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        );

        if let Ok((source_path, translation_path, metadata_path)) = result {
            let _ = std::fs::remove_file(&source_path);
            let _ = std::fs::remove_file(&translation_path);
            let _ = std::fs::remove_file(&metadata_path);

            if let Some(parent) = std::path::Path::new(&source_path).parent() {
                let _ = std::fs::remove_dir(parent);
            }

            if conn
                .execute("DELETE FROM recordings WHERE id = ?1", [id])
                .is_ok()
            {
                deleted += 1;
            }
        }
    }

    Ok(Json(BulkDeleteResponse {
        deleted,
        requested: body.ids.len() as u32,
    }))
}

#[derive(Deserialize, ToSchema)]
pub struct BulkDeleteRequest {
    pub ids: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct BulkDeleteResponse {
    pub deleted: u32,
    pub requested: u32,
}
