use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth;
use crate::error::AppError;
use crate::AppState;

#[derive(Deserialize, ToSchema)]
pub struct CreateAbcRequest {
    pub name: String,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateAbcRequest {
    pub name: String,
}

#[derive(Serialize, ToSchema)]
pub struct AbcResponse {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct AbcCredentialsResponse {
    pub id: String,
    pub name: String,
    pub secret: String,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct AbcsListResponse {
    pub items: Vec<AbcResponse>,
}

#[derive(Deserialize, ToSchema)]
pub struct AbcRegisterRequest {
    pub abc_id: String,
    pub abc_secret: String,
}

#[derive(Serialize, ToSchema)]
pub struct AbcRegisterResponse {
    pub status: String,
}

#[derive(Serialize, ToSchema)]
pub struct RotateSecretResponse {
    pub id: String,
    pub secret: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/abcs",
    responses(
        (status = 200, description = "List ABCs", body = AbcsListResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_abcs(
    State(state): State<AppState>,
) -> Result<Json<AbcsListResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at FROM abcs ORDER BY created_at DESC")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let abcs = stmt
        .query_map([], |row| {
            Ok(AbcResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(AbcsListResponse { items: abcs }))
}

#[utoipa::path(
    post,
    path = "/api/v1/abcs",
    request_body = CreateAbcRequest,
    responses(
        (status = 201, description = "ABC created", body = AbcCredentialsResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_abc(
    State(state): State<AppState>,
    Json(body): Json<CreateAbcRequest>,
) -> Result<(StatusCode, Json<AbcCredentialsResponse>), AppError> {
    if body.name.is_empty() {
        return Err(AppError::ValidationError("Name is required".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    let secret = auth::generate_abc_secret();
    let secret_hash = auth::hash_password(&secret)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute(
        "INSERT INTO abcs (id, name, secret_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, body.name, secret_hash, now, now],
    )?;

    Ok((
        StatusCode::CREATED,
        Json(AbcCredentialsResponse {
            id,
            name: body.name,
            secret,
            created_at: now,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/abcs/{id}",
    params(("id" = String, Path, description = "ABC ID")),
    responses(
        (status = 200, description = "ABC details", body = AbcResponse),
        (status = 404, description = "ABC not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_abc(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AbcResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let abc = conn
        .query_row(
            "SELECT id, name, created_at, updated_at FROM abcs WHERE id = ?1",
            [&id],
            |row| {
                Ok(AbcResponse {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("ABC '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    Ok(Json(abc))
}

#[utoipa::path(
    put,
    path = "/api/v1/abcs/{id}",
    params(("id" = String, Path, description = "ABC ID")),
    request_body = UpdateAbcRequest,
    responses(
        (status = 200, description = "ABC updated", body = AbcResponse),
        (status = 404, description = "ABC not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_abc(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateAbcRequest>,
) -> Result<Json<AbcResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    let changed = conn
        .execute(
            "UPDATE abcs SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![body.name, now, id],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if changed == 0 {
        return Err(AppError::NotFound(format!("ABC '{}' not found", id)));
    }

    get_abc(State(state), Path(id)).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/abcs/{id}",
    params(("id" = String, Path, description = "ABC ID")),
    responses(
        (status = 204, description = "ABC deleted"),
        (status = 404, description = "ABC not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_abc(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let changed = conn
        .execute("DELETE FROM abcs WHERE id = ?1", [&id])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if changed == 0 {
        return Err(AppError::NotFound(format!("ABC '{}' not found", id)));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/abcs/{id}/rotate-secret",
    params(("id" = String, Path, description = "ABC ID")),
    responses(
        (status = 200, description = "Secret rotated", body = RotateSecretResponse),
        (status = 404, description = "ABC not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn rotate_secret(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RotateSecretResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let _existing = conn
        .query_row("SELECT id FROM abcs WHERE id = ?1", [&id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("ABC '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    let new_secret = auth::generate_abc_secret();
    let secret_hash = auth::hash_password(&new_secret)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE abcs SET secret_hash = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![secret_hash, now, id],
    )?;

    Ok(Json(RotateSecretResponse {
        id,
        secret: new_secret,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/abc/register",
    request_body = AbcRegisterRequest,
    responses(
        (status = 200, description = "ABC registered", body = AbcRegisterResponse),
        (status = 401, description = "Invalid credentials"),
    )
)]
pub async fn abc_register(
    State(state): State<AppState>,
    Json(body): Json<AbcRegisterRequest>,
) -> Result<Json<AbcRegisterResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let secret_hash: String = conn
        .query_row(
            "SELECT secret_hash FROM abcs WHERE id = ?1",
            [&body.abc_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Unauthorized("Invalid ABC credentials".to_string()))?;

    if !auth::verify_password(&body.abc_secret, &secret_hash) {
        return Err(AppError::Unauthorized("Invalid ABC credentials".to_string()));
    }

    Ok(Json(AbcRegisterResponse {
        status: "registered".to_string(),
    }))
}
