use crate::config::AbcConfig;
use crate::webrtc_peer;
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite;
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
pub enum SignalingOutcome {
    SessionEnded { session_name: String },
    Disconnected,
}

pub async fn run_signaling_loop(
    cfg: &AbcConfig,
    ws_url: &str,
    cancel: CancellationToken,
) -> Result<SignalingOutcome> {
    let full_url = format!("{}?token={}", ws_url, cfg.identity.abc_secret);
    tracing::info!(url = %ws_url, "Connecting to signaling WebSocket");

    let (ws_stream, _) = tokio_tungstenite::connect_async(&full_url).await?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    tracing::info!("WebSocket connected");

    let mut peer_connection: Option<webrtc_peer::AbcPeerConnection> = None;
    let (ice_tx, mut ice_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut session_name = String::new();

    let ping_interval = tokio::time::interval(std::time::Duration::from_secs(15));
    tokio::pin!(ping_interval);

    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(tungstenite::Message::Text(text))) => {
                        let parsed: serde_json::Value = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        let msg_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        tracing::debug!(msg_type, "Received signaling message");

                        match msg_type {
                            "welcome" => {
                                tracing::info!("Received welcome from server");
                            }
                            "session-start" => {
                                let session_id = parsed["session_id"].as_str().unwrap_or("").to_string();
                                session_name = parsed["session_name"].as_str().unwrap_or("").to_string();
                                tracing::info!(session_id, session_name = session_name.as_str(), "Session starting");

                                #[cfg(feature = "headless")]
                                crate::verification::GLOBAL_VERIFICATION
                                    .set_state("session_active", &session_name);

                                let ice_tx_clone = ice_tx.clone();
                                match webrtc_peer::create_peer_connection(ice_tx_clone).await {
                                    Ok(pc) => {
                                        let offer = pc.create_and_set_offer().await?;
                                        let offer_msg = serde_json::json!({
                                            "type": "offer",
                                            "sdp": offer,
                                        });
                                        ws_tx.send(tungstenite::Message::Text(
                                            offer_msg.to_string().into(),
                                        )).await?;
                                        peer_connection = Some(pc);
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to create peer connection");
                                    }
                                }
                            }
                            "session-stop" => {
                                tracing::info!("Session stopped by server");
                                if let Some(pc) = peer_connection.take() {
                                    pc.close().await;
                                }
                                #[cfg(feature = "headless")]
                                crate::verification::GLOBAL_VERIFICATION.set_state("idle", "");

                                return Ok(SignalingOutcome::SessionEnded {
                                    session_name: session_name.clone(),
                                });
                            }
                            "answer" => {
                                if let Some(pc) = &peer_connection {
                                    let sdp = parsed["sdp"].as_str().unwrap_or("");
                                    if let Err(e) = pc.set_remote_answer(sdp).await {
                                        tracing::error!(error = %e, "Failed to set remote answer");
                                    }
                                }
                            }
                            "offer" => {
                                if let Some(pc) = &peer_connection {
                                    let sdp = parsed["sdp"].as_str().unwrap_or("");
                                    match pc.handle_offer_and_answer(sdp).await {
                                        Ok(answer) => {
                                            let answer_msg = serde_json::json!({
                                                "type": "answer",
                                                "sdp": answer,
                                            });
                                            ws_tx.send(tungstenite::Message::Text(
                                                answer_msg.to_string().into(),
                                            )).await?;
                                        }
                                        Err(e) => {
                                            tracing::error!(error = %e, "Failed to handle offer");
                                        }
                                    }
                                }
                            }
                            "ice-candidate" => {
                                if let Some(pc) = &peer_connection {
                                    let candidate = parsed["candidate"].as_str().unwrap_or("");
                                    let sdp_mid = parsed["sdp_mid"].as_str().map(String::from);
                                    let sdp_m_line_index = parsed["sdp_m_line_index"].as_u64().map(|v| v as u16);
                                    if let Err(e) = pc.add_ice_candidate(candidate, sdp_mid, sdp_m_line_index).await {
                                        tracing::error!(error = %e, "Failed to add ICE candidate");
                                    }
                                }
                            }
                            "ping" => {
                                let pong = serde_json::json!({"type": "pong"});
                                ws_tx.send(tungstenite::Message::Text(
                                    pong.to_string().into(),
                                )).await?;
                            }
                            "error" => {
                                let code = parsed["code"].as_str().unwrap_or("unknown");
                                let message = parsed["message"].as_str().unwrap_or("unknown");
                                tracing::error!(code, message, "Server error");
                            }
                            _ => {
                                tracing::debug!(msg_type, "Unhandled message type");
                            }
                        }
                    }
                    Some(Ok(tungstenite::Message::Close(_))) | None => {
                        tracing::info!("WebSocket closed");
                        if let Some(pc) = peer_connection.take() {
                            pc.close().await;
                        }
                        return Ok(SignalingOutcome::Disconnected);
                    }
                    Some(Ok(tungstenite::Message::Ping(data))) => {
                        ws_tx.send(tungstenite::Message::Pong(data)).await?;
                    }
                    Some(Err(e)) => {
                        tracing::warn!(error = %e, "WebSocket error");
                        if let Some(pc) = peer_connection.take() {
                            pc.close().await;
                        }
                        return Ok(SignalingOutcome::Disconnected);
                    }
                    _ => {}
                }
            }
            ice_msg = ice_rx.recv() => {
                if let Some(ice_json) = ice_msg {
                    ws_tx.send(tungstenite::Message::Text(ice_json.into())).await?;
                }
            }
            _ = ping_interval.tick() => {
                let ping = serde_json::json!({"type": "ping"});
                if ws_tx.send(tungstenite::Message::Text(
                    ping.to_string().into(),
                )).await.is_err() {
                    return Ok(SignalingOutcome::Disconnected);
                }
            }
            _ = cancel.cancelled() => {
                tracing::info!("Signaling loop cancelled");
                if let Some(pc) = peer_connection.take() {
                    pc.close().await;
                }
                return Ok(SignalingOutcome::Disconnected);
            }
        }
    }
}
