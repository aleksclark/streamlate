mod config;
mod signaling;
mod state_machine;
mod webrtc_peer;

#[cfg(feature = "headless")]
mod headless;
#[cfg(feature = "headless")]
mod verification;

use anyhow::Result;
use state_machine::AbcState;
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("STREAMLATE_LOG_LEVEL")
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cfg = config::load_config()?;
    tracing::info!(abc_id = %cfg.identity.abc_id, server = %cfg.server.url, "Starting ABC");

    let cancel = CancellationToken::new();

    let shutdown_token = cancel.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        tracing::info!("Shutdown signal received, initiating graceful shutdown");
        shutdown_token.cancel();
    });

    #[cfg(feature = "headless")]
    {
        let verification_state = verification::VerificationState::new();
        let vs_clone = verification_state.clone();
        let cancel_clone = cancel.clone();
        tokio::spawn(async move {
            tokio::select! {
                result = verification::run_verification_server(vs_clone) => {
                    if let Err(e) = result {
                        tracing::error!(error = %e, "Verification server error");
                    }
                }
                _ = cancel_clone.cancelled() => {
                    tracing::info!("Verification server shutting down");
                }
            }
        });
    }

    run_abc_loop(cfg, cancel).await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("failed to listen for ctrl+c");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn run_abc_loop(cfg: config::AbcConfig, cancel: CancellationToken) -> Result<()> {
    let mut state = AbcState::Booting;
    let mut backoff_ms: u64 = 1000;
    let max_backoff_ms: u64 = 30_000;

    loop {
        if cancel.is_cancelled() {
            tracing::info!("Shutting down ABC");
            return Ok(());
        }

        tracing::info!(state = %state, "State transition");

        #[cfg(feature = "headless")]
        verification::GLOBAL_VERIFICATION.set_state(&state.to_string(), "");

        match state {
            AbcState::Booting => {
                state = AbcState::ConnectingServer;
            }
            AbcState::ConnectingServer => {
                tokio::select! {
                    result = register_with_server(&cfg) => {
                        match result {
                            Ok(signaling_url) => {
                                backoff_ms = 1000;
                                state = AbcState::Idle { signaling_url };
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, backoff_ms, "Registration failed, retrying");
                                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                                backoff_ms = (backoff_ms * 2).min(max_backoff_ms);
                            }
                        }
                    }
                    _ = cancel.cancelled() => {
                        tracing::info!("Shutdown during server connection");
                        return Ok(());
                    }
                }
            }
            AbcState::Idle { ref signaling_url } => {
                let url = signaling_url.clone();
                #[cfg(feature = "headless")]
                verification::GLOBAL_VERIFICATION.set_state("idle", "");

                tokio::select! {
                    result = signaling::run_signaling_loop(&cfg, &url, cancel.clone()) => {
                        match result {
                            Ok(signaling::SignalingOutcome::SessionEnded { session_name }) => {
                                tracing::info!(session_name = %session_name, "Session ended, reconnecting");
                                state = AbcState::ConnectingServer;
                                backoff_ms = 1000;
                            }
                            Ok(signaling::SignalingOutcome::Disconnected) => {
                                tracing::info!("Signaling disconnected, reconnecting");
                                state = AbcState::Reconnecting {
                                    reason: "signaling disconnected".into(),
                                };
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "Signaling error");
                                state = AbcState::Reconnecting {
                                    reason: format!("signaling error: {e}"),
                                };
                            }
                        }
                    }
                    _ = cancel.cancelled() => {
                        tracing::info!("Shutdown during signaling");
                        return Ok(());
                    }
                }
            }
            AbcState::Reconnecting { ref reason } => {
                tracing::warn!(reason = %reason, backoff_ms, "Reconnecting");
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)) => {
                        backoff_ms = (backoff_ms * 2).min(max_backoff_ms);
                        state = AbcState::ConnectingServer;
                    }
                    _ = cancel.cancelled() => {
                        tracing::info!("Shutdown during reconnect backoff");
                        return Ok(());
                    }
                }
            }
            AbcState::Error(ref msg) => {
                tracing::error!(error = %msg, "ABC error state");
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
                        state = AbcState::ConnectingServer;
                    }
                    _ = cancel.cancelled() => {
                        tracing::info!("Shutdown from error state");
                        return Ok(());
                    }
                }
            }
        }
    }
}

async fn register_with_server(cfg: &config::AbcConfig) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/abc/register", cfg.server.url);

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "abc_id": cfg.identity.abc_id,
            "abc_secret": cfg.identity.abc_secret,
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        anyhow::bail!("Registration failed: HTTP {}", resp.status());
    }

    let body: serde_json::Value = resp.json().await?;
    let signaling_path = body["signaling_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing signaling_url"))?;

    let base = &cfg.server.url;
    let ws_url = if base.starts_with("https") {
        format!(
            "wss://{}{}",
            base.trim_start_matches("https://"),
            signaling_path
        )
    } else {
        format!(
            "ws://{}{}",
            base.trim_start_matches("http://"),
            signaling_path
        )
    };

    tracing::info!(signaling_url = %ws_url, "Registered with server");
    Ok(ws_url)
}
