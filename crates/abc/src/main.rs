use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("ABC_LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let headless = std::env::args().any(|a| a == "--headless");

    if headless {
        tracing::info!("Starting streamlate-abc in headless mode");
    } else {
        tracing::info!("Starting streamlate-abc");
    }

    let server_url =
        std::env::var("ABC_SERVER_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
    tracing::info!("Server URL: {}", server_url);

    #[cfg(feature = "headless")]
    {
        tracing::info!("Headless feature enabled — using synthetic audio I/O");
    }

    tracing::info!("ABC simulator running (idle loop)");
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}
