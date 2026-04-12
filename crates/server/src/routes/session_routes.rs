use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::AppState;

#[derive(Deserialize, ToSchema)]
pub struct CreateSessionRequest {
    pub abc_id: String,
    pub session_name: String,
    pub pin: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SessionResponse {
    pub id: String,
    pub abc_id: String,
    pub translator_id: String,
    pub session_name: String,
    pub state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct SessionsListResponse {
    pub items: Vec<SessionResponse>,
}

#[derive(Deserialize, IntoParams)]
pub struct SessionsQuery {
    pub state: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/sessions",
    params(SessionsQuery),
    responses(
        (status = 200, description = "List sessions", body = SessionsListResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<SessionsQuery>,
) -> Result<Json<SessionsListResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let sessions = if let Some(filter_state) = &query.state {
        let mut stmt = conn
            .prepare(
                "SELECT id, abc_id, translator_id, session_name, state, started_at, ended_at, created_at
                 FROM sessions WHERE state = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let rows = stmt.query_map([filter_state], |row| {
            Ok(SessionResponse {
                id: row.get(0)?,
                abc_id: row.get(1)?,
                translator_id: row.get(2)?,
                session_name: row.get(3)?,
                state: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, abc_id, translator_id, session_name, state, started_at, ended_at, created_at
                 FROM sessions ORDER BY created_at DESC",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let rows = stmt.query_map([], |row| {
            Ok(SessionResponse {
                id: row.get(0)?,
                abc_id: row.get(1)?,
                translator_id: row.get(2)?,
                session_name: row.get(3)?,
                state: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?
    };

    Ok(Json(SessionsListResponse { items: sessions }))
}

#[utoipa::path(
    post,
    path = "/api/v1/sessions",
    request_body = CreateSessionRequest,
    responses(
        (status = 201, description = "Session created", body = SessionResponse),
        (status = 409, description = "ABC already in session"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_session(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<(StatusCode, Json<SessionResponse>), AppError> {
    let user = req
        .extensions()
        .get::<AuthUser>()
        .ok_or_else(|| AppError::Unauthorized("Not authenticated".to_string()))?
        .clone();

    let body: CreateSessionRequest = serde_json::from_slice(
        &axum::body::to_bytes(req.into_body(), 1024 * 1024)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?,
    )
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let _abc = conn
        .query_row("SELECT id FROM abcs WHERE id = ?1", [&body.abc_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|_| AppError::NotFound(format!("ABC '{}' not found", body.abc_id)))?;

    let active_session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE abc_id = ?1 AND state IN ('starting', 'active', 'paused', 'passthrough')",
            [&body.abc_id],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if active_session_count > 0 {
        return Err(AppError::Conflict(format!(
            "ABC '{}' is already assigned to an active session",
            body.abc_id
        )));
    }

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO sessions (id, abc_id, translator_id, session_name, pin, state, started_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            id,
            body.abc_id,
            user.user_id,
            body.session_name,
            body.pin,
            "starting",
            now,
            now
        ],
    )?;

    Ok((
        StatusCode::CREATED,
        Json(SessionResponse {
            id,
            abc_id: body.abc_id,
            translator_id: user.user_id,
            session_name: body.session_name,
            state: "starting".to_string(),
            started_at: now.clone(),
            ended_at: None,
            created_at: now,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/sessions/{id}",
    params(("id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session details", body = SessionResponse),
        (status = 404, description = "Session not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SessionResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let session = conn
        .query_row(
            "SELECT id, abc_id, translator_id, session_name, state, started_at, ended_at, created_at
             FROM sessions WHERE id = ?1",
            [&id],
            |row| {
                Ok(SessionResponse {
                    id: row.get(0)?,
                    abc_id: row.get(1)?,
                    translator_id: row.get(2)?,
                    session_name: row.get(3)?,
                    state: row.get(4)?,
                    started_at: row.get(5)?,
                    ended_at: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Session '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    Ok(Json(session))
}

#[utoipa::path(
    post,
    path = "/api/v1/sessions/{id}/stop",
    params(("id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session stopped", body = SessionResponse),
        (status = 404, description = "Session not found"),
        (status = 409, description = "Session already completed"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn stop_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SessionResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let current_state: String = conn
        .query_row(
            "SELECT state FROM sessions WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Session '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    if current_state == "completed" || current_state == "failed" {
        return Err(AppError::Conflict(format!(
            "Session is already in '{}' state",
            current_state
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET state = 'completed', ended_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )?;

    get_session(State(state), Path(id)).await
}
