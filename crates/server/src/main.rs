use std::net::SocketAddr;

use axum::{Json, Router, routing::get};
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Streamlate API",
        version = "0.1.0",
        description = "Simultaneous audio translation infrastructure"
    ),
    paths(health, openapi_spec),
    components(schemas(HealthResponse))
)]
struct ApiDoc;

#[derive(serde::Serialize, utoipa::ToSchema)]
struct HealthResponse {
    status: String,
    version: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/system/health",
    responses(
        (status = 200, description = "Server is healthy", body = HealthResponse)
    )
)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    responses(
        (status = 200, description = "OpenAPI specification")
    )
)]
async fn openapi_spec() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

fn build_router() -> Router {
    Router::new()
        .route("/api/v1/system/health", get(health))
        .route("/api/openapi.json", get(openapi_spec))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("STREAMLATE_LOG_LEVEL")
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if std::env::args().any(|a| a == "--export-openapi") {
        let spec = ApiDoc::openapi();
        println!("{}", serde_json::to_string_pretty(&spec)?);
        return Ok(());
    }

    let bind = std::env::var("STREAMLATE_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let addr: SocketAddr = bind.parse()?;

    tracing::info!("Starting streamlate-server on {}", addr);

    let app = build_router();
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_check() {
        let app = build_router();
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/v1/system/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let health: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(health["status"], "ok");
    }

    #[tokio::test]
    async fn test_openapi_spec() {
        let app = build_router();
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/openapi.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let spec: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(spec["openapi"].as_str().unwrap().starts_with("3."));
    }
}
