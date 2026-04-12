use axum::extract::State;
use axum::http::{header::SET_COOKIE, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth;
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::AppState;

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize, ToSchema)]
pub struct LoginResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub user: LoginUserInfo,
}

#[derive(Serialize, ToSchema)]
pub struct LoginUserInfo {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Serialize, ToSchema)]
pub struct RefreshResponse {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Serialize, ToSchema)]
pub struct MeResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

fn extract_cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    for header_value in headers.get_all(axum::http::header::COOKIE) {
        if let Ok(s) = header_value.to_str() {
            for part in s.split(';') {
                let part = part.trim();
                if let Some(val) = part.strip_prefix(&format!("{}=", name)) {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

fn make_refresh_cookie(token: &str, max_age_seconds: i64) -> String {
    format!(
        "refresh_token={}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age={}",
        token, max_age_seconds
    )
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = LoginResponse),
        (status = 401, description = "Invalid credentials"),
        (status = 429, description = "Rate limit exceeded"),
    )
)]
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Response, AppError> {
    let ip_key = "login_ip:global".to_string();
    if !state.rate_limiter.check_rate_limit(&ip_key, 10, 60) {
        return Err(AppError::RateLimitExceeded);
    }

    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let user = conn
        .query_row(
            "SELECT id, email, password_hash, display_name, role FROM users WHERE email = ?1",
            [&body.email],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| AppError::Unauthorized("Invalid email or password".to_string()))?;

    let (id, email, password_hash, display_name, role) = user;

    if !auth::verify_password(&body.password, &password_hash) {
        return Err(AppError::Unauthorized("Invalid email or password".to_string()));
    }

    let access_token = auth::create_access_token(
        &id,
        &role,
        &state.config.auth.jwt_secret,
        state.config.auth.access_token_ttl_seconds,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let refresh_token = auth::generate_refresh_token();
    let refresh_hash = auth::hash_refresh_token(&refresh_token);
    auth::store_refresh_token(
        &conn,
        &id,
        &refresh_hash,
        state.config.auth.refresh_token_ttl_seconds,
    )?;

    let cookie = make_refresh_cookie(
        &refresh_token,
        state.config.auth.refresh_token_ttl_seconds as i64,
    );

    let body = LoginResponse {
        access_token,
        expires_in: state.config.auth.access_token_ttl_seconds,
        user: LoginUserInfo {
            id,
            email,
            display_name,
            role,
        },
    };

    let mut response = (StatusCode::OK, Json(body)).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        cookie.parse().unwrap(),
    );

    Ok(response)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/refresh",
    responses(
        (status = 200, description = "Token refreshed", body = RefreshResponse),
        (status = 401, description = "Invalid refresh token"),
    )
)]
pub async fn refresh(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<Response, AppError> {
    let refresh_key = "refresh_ip:global".to_string();
    if !state.rate_limiter.check_rate_limit(&refresh_key, 30, 60) {
        return Err(AppError::RateLimitExceeded);
    }

    let refresh_token = extract_cookie_value(req.headers(), "refresh_token")
        .ok_or_else(|| AppError::Unauthorized("Missing refresh token".to_string()))?;

    let token_hash = auth::hash_refresh_token(&refresh_token);
    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let result = auth::validate_refresh_token(&conn, &token_hash)?;
    let (_token_id, user_id) = result
        .ok_or_else(|| AppError::Unauthorized("Invalid or expired refresh token".to_string()))?;

    auth::revoke_refresh_token(&conn, &token_hash)?;

    let role: String = conn
        .query_row("SELECT role FROM users WHERE id = ?1", [&user_id], |row| {
            row.get(0)
        })
        .map_err(|_| AppError::Unauthorized("User not found".to_string()))?;

    let access_token = auth::create_access_token(
        &user_id,
        &role,
        &state.config.auth.jwt_secret,
        state.config.auth.access_token_ttl_seconds,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let new_refresh_token = auth::generate_refresh_token();
    let new_refresh_hash = auth::hash_refresh_token(&new_refresh_token);
    auth::store_refresh_token(
        &conn,
        &user_id,
        &new_refresh_hash,
        state.config.auth.refresh_token_ttl_seconds,
    )?;

    let cookie = make_refresh_cookie(
        &new_refresh_token,
        state.config.auth.refresh_token_ttl_seconds as i64,
    );

    let body = RefreshResponse {
        access_token,
        expires_in: state.config.auth.access_token_ttl_seconds,
    };

    let mut response = Json(body).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        cookie.parse().unwrap(),
    );

    Ok(response)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    responses(
        (status = 204, description = "Logged out"),
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<Response, AppError> {
    if let Some(refresh_token) = extract_cookie_value(req.headers(), "refresh_token") {
        let token_hash = auth::hash_refresh_token(&refresh_token);
        let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;
        let _ = auth::revoke_refresh_token(&conn, &token_hash);
    }

    let cookie = make_refresh_cookie("", 0);
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        cookie.parse().unwrap(),
    );

    Ok(response)
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/me",
    responses(
        (status = 200, description = "Current user", body = MeResponse),
        (status = 401, description = "Not authenticated"),
    ),
    security(("bearer_auth" = []))
)]
pub async fn me(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<Json<MeResponse>, AppError> {
    let user = req
        .extensions()
        .get::<AuthUser>()
        .ok_or_else(|| AppError::Unauthorized("Not authenticated".to_string()))?
        .clone();

    let conn = state.db.conn().map_err(|e| AppError::Internal(e.to_string()))?;

    let (email, display_name, role) = conn
        .query_row(
            "SELECT email, display_name, role FROM users WHERE id = ?1",
            [&user.user_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|_| AppError::NotFound("User not found".to_string()))?;

    Ok(Json(MeResponse {
        id: user.user_id,
        email,
        display_name,
        role,
    }))
}
