use axum::extract::{Request, State};
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::Response;

use crate::auth;
use crate::error::AppError;
use crate::AppState;

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub role: String,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".to_string()))?;

    let claims = auth::validate_access_token(token, &state.config.auth.jwt_secret)
        .map_err(|_| AppError::Unauthorized("Invalid or expired token".to_string()))?;

    let user = AuthUser {
        user_id: claims.sub,
        role: claims.role,
    };

    req.extensions_mut().insert(user);
    Ok(next.run(req).await)
}

pub async fn require_admin(
    State(_state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user = req
        .extensions()
        .get::<AuthUser>()
        .ok_or_else(|| AppError::Unauthorized("Not authenticated".to_string()))?
        .clone();

    if user.role != "admin" {
        return Err(AppError::Forbidden(
            "Admin access required".to_string(),
        ));
    }

    Ok(next.run(req).await)
}
