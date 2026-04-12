mod auth_routes;
mod user_routes;
mod abc_routes;
mod session_routes;
mod system_routes;
pub mod ws_routes;
pub mod health_routes;

use axum::middleware as axum_mw;
use axum::Router;
use utoipa::OpenApi;

use crate::middleware;
use crate::AppState;

#[derive(OpenApi)]
#[openapi(
    paths(
        system_routes::health,
        auth_routes::login,
        auth_routes::refresh,
        auth_routes::logout,
        auth_routes::me,
        user_routes::list_users,
        user_routes::create_user,
        user_routes::get_user,
        user_routes::update_user,
        user_routes::delete_user,
        abc_routes::list_abcs,
        abc_routes::create_abc,
        abc_routes::get_abc,
        abc_routes::update_abc,
        abc_routes::delete_abc,
        abc_routes::rotate_secret,
        abc_routes::abc_register,
        session_routes::list_sessions,
        session_routes::create_session,
        session_routes::get_session,
        session_routes::stop_session,
    ),
    components(schemas(
        system_routes::HealthResponse,
        auth_routes::LoginRequest,
        auth_routes::LoginResponse,
        auth_routes::RefreshResponse,
        auth_routes::MeResponse,
        user_routes::CreateUserRequest,
        user_routes::UpdateUserRequest,
        user_routes::UserResponse,
        user_routes::UsersListResponse,
        abc_routes::CreateAbcRequest,
        abc_routes::UpdateAbcRequest,
        abc_routes::AbcResponse,
        abc_routes::AbcCredentialsResponse,
        abc_routes::AbcsListResponse,
        abc_routes::AbcRegisterRequest,
        abc_routes::AbcRegisterResponse,
        abc_routes::RotateSecretResponse,
        session_routes::CreateSessionRequest,
        session_routes::SessionResponse,
        session_routes::SessionsListResponse,
    ))
)]
pub struct ApiDoc;

pub fn openapi_spec() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}

pub fn build_router(state: AppState) -> Router {
    let auth_routes = Router::new()
        .route("/login", axum::routing::post(auth_routes::login))
        .route("/refresh", axum::routing::post(auth_routes::refresh))
        .route("/logout", axum::routing::post(auth_routes::logout))
        .route(
            "/me",
            axum::routing::get(auth_routes::me)
                .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_auth)),
        );

    let user_routes = Router::new()
        .route("/", axum::routing::get(user_routes::list_users).post(user_routes::create_user))
        .route(
            "/{id}",
            axum::routing::get(user_routes::get_user)
                .put(user_routes::update_user)
                .delete(user_routes::delete_user),
        )
        .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_admin))
        .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_auth));

    let abc_routes = Router::new()
        .route(
            "/",
            axum::routing::get(abc_routes::list_abcs).post(abc_routes::create_abc),
        )
        .route(
            "/{id}",
            axum::routing::get(abc_routes::get_abc)
                .put(abc_routes::update_abc)
                .delete(abc_routes::delete_abc),
        )
        .route(
            "/{id}/rotate-secret",
            axum::routing::post(abc_routes::rotate_secret),
        )
        .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_admin))
        .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_auth));

    let abc_self_register = Router::new()
        .route("/register", axum::routing::post(abc_routes::abc_register));

    let session_routes = Router::new()
        .route(
            "/",
            axum::routing::get(session_routes::list_sessions)
                .post(session_routes::create_session),
        )
        .route("/{id}", axum::routing::get(session_routes::get_session))
        .route(
            "/{id}/stop",
            axum::routing::post(session_routes::stop_session),
        )
        .route(
            "/{id}/health",
            axum::routing::get(health_routes::get_session_health),
        )
        .route_layer(axum_mw::from_fn_with_state(state.clone(), middleware::require_auth));

    let system_routes = Router::new()
        .route("/health", axum::routing::get(system_routes::health));

    let openapi_route = Router::new()
        .route("/openapi.json", axum::routing::get(serve_openapi));

    let ws_routes = Router::new()
        .route("/ws/abc/{abc_id}", axum::routing::get(ws_routes::ws_abc))
        .route("/ws/translate/{session_id}", axum::routing::get(ws_routes::ws_translator))
        .route("/ws/listen/{session_id}", axum::routing::get(ws_routes::ws_listener));

    let abc_status_route = Router::new()
        .route(
            "/api/v1/abcs/{id}/status",
            axum::routing::get(health_routes::get_abc_status),
        );

    Router::new()
        .nest("/api/v1/auth", auth_routes)
        .nest("/api/v1/users", user_routes)
        .nest("/api/v1/abcs", abc_routes)
        .nest("/api/v1/abc", abc_self_register)
        .nest("/api/v1/sessions", session_routes)
        .nest("/api/v1/system", system_routes)
        .nest("/api", openapi_route)
        .merge(ws_routes)
        .merge(abc_status_route)
        .with_state(state)
}

async fn serve_openapi() -> axum::Json<utoipa::openapi::OpenApi> {
    axum::Json(openapi_spec())
}
