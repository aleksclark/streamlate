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
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateUserRequest {
    pub email: Option<String>,
    pub password: Option<String>,
    pub display_name: Option<String>,
    pub role: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct UsersListResponse {
    pub items: Vec<UserResponse>,
}

#[utoipa::path(
    get,
    path = "/api/v1/users",
    responses(
        (status = 200, description = "List users", body = UsersListResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_users(
    State(state): State<AppState>,
) -> Result<Json<UsersListResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT id, email, display_name, role, created_at, updated_at FROM users ORDER BY created_at DESC")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let users = stmt
        .query_map([], |row| {
            Ok(UserResponse {
                id: row.get(0)?,
                email: row.get(1)?,
                display_name: row.get(2)?,
                role: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| AppError::Internal(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(UsersListResponse { items: users }))
}

#[utoipa::path(
    post,
    path = "/api/v1/users",
    request_body = CreateUserRequest,
    responses(
        (status = 201, description = "User created", body = UserResponse),
        (status = 409, description = "Email already exists"),
        (status = 422, description = "Validation error"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    if body.email.is_empty() || !body.email.contains('@') {
        return Err(AppError::ValidationError("Invalid email".to_string()));
    }
    if body.password.len() < 8 {
        return Err(AppError::ValidationError(
            "Password must be at least 8 characters".to_string(),
        ));
    }
    if body.role != "admin" && body.role != "translator" {
        return Err(AppError::ValidationError(
            "Role must be 'admin' or 'translator'".to_string(),
        ));
    }

    let password_hash = auth::hash_password(&body.password)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, body.email, password_hash, body.display_name, body.role, now, now],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            AppError::Conflict(format!("User with email '{}' already exists", body.email))
        } else {
            AppError::Internal(e.to_string())
        }
    })?;

    Ok((
        StatusCode::CREATED,
        Json(UserResponse {
            id,
            email: body.email,
            display_name: body.display_name,
            role: body.role,
            created_at: now.clone(),
            updated_at: now,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "User details", body = UserResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<UserResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let user = conn
        .query_row(
            "SELECT id, email, display_name, role, created_at, updated_at FROM users WHERE id = ?1",
            [&id],
            |row| {
                Ok(UserResponse {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    display_name: row.get(2)?,
                    role: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("User '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    Ok(Json(user))
}

#[utoipa::path(
    put,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User ID")),
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "User updated", body = UserResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let _existing = conn
        .query_row("SELECT id FROM users WHERE id = ?1", [&id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("User '{}' not found", id))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

    let now = chrono::Utc::now().to_rfc3339();

    if let Some(ref email) = body.email {
        if email.is_empty() || !email.contains('@') {
            return Err(AppError::ValidationError("Invalid email".to_string()));
        }
        conn.execute(
            "UPDATE users SET email = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![email, now, id],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                AppError::Conflict(format!("User with email '{}' already exists", email))
            } else {
                AppError::Internal(e.to_string())
            }
        })?;
    }

    if let Some(ref password) = body.password {
        if password.len() < 8 {
            return Err(AppError::ValidationError(
                "Password must be at least 8 characters".to_string(),
            ));
        }
        let hash = auth::hash_password(password)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![hash, now, id],
        )?;
    }

    if let Some(ref display_name) = body.display_name {
        conn.execute(
            "UPDATE users SET display_name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![display_name, now, id],
        )?;
    }

    if let Some(ref role) = body.role {
        if role != "admin" && role != "translator" {
            return Err(AppError::ValidationError(
                "Role must be 'admin' or 'translator'".to_string(),
            ));
        }
        conn.execute(
            "UPDATE users SET role = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![role, now, id],
        )?;
    }

    get_user(State(state), Path(id)).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User ID")),
    responses(
        (status = 204, description = "User deleted"),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let changed = conn
        .execute("DELETE FROM users WHERE id = ?1", [&id])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if changed == 0 {
        return Err(AppError::NotFound(format!("User '{}' not found", id)));
    }

    Ok(StatusCode::NO_CONTENT)
}
