use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::auth;
use crate::error::AppError;
use crate::session_manager::SessionCommand;
use crate::signaling::SignalingMessage;
use crate::AppState;

#[derive(Deserialize)]
pub struct WsAuthQuery {
    token: Option<String>,
    pin: Option<String>,
}

pub async fn ws_abc(
    State(state): State<AppState>,
    Path(abc_id): Path<String>,
    Query(query): Query<WsAuthQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let token = query
        .token
        .ok_or_else(|| AppError::Unauthorized("Missing token query parameter".to_string()))?;

    let conn = state
        .db
        .conn()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let secret_hash: String = conn
        .query_row(
            "SELECT secret_hash FROM abcs WHERE id = ?1",
            [&abc_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Unauthorized("Invalid ABC".to_string()))?;

    if !auth::verify_password(&token, &secret_hash) {
        return Err(AppError::Unauthorized("Invalid ABC secret".to_string()));
    }

    let session_mgr = state.session_manager.clone();
    let aid = abc_id.clone();

    Ok(ws.on_upgrade(move |socket| handle_abc_ws(socket, session_mgr, aid)))
}

async fn handle_abc_ws(
    socket: WebSocket,
    session_mgr: crate::session_manager::SessionManager,
    abc_id: String,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<SignalingMessage>();

    session_mgr.send(SessionCommand::AbcConnected {
        abc_id: abc_id.clone(),
        ws_tx: tx.clone(),
    });

    let _ = tx.send(SignalingMessage::Welcome {
        session_id: None,
        abc_id: Some(abc_id.clone()),
    });

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(_) => continue,
            };
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    let abc_id_clone = abc_id.clone();
    let sm = session_mgr.clone();
    let recv_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            handle_abc_message(&sm, &abc_id_clone, &text);
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    let _ = tx.send(SignalingMessage::Ping);
                }
            }
        }
        sm.send(SessionCommand::AbcDisconnected {
            abc_id: abc_id_clone,
        });
    });

    let _ = tokio::select! {
        r = send_task => r,
        r = recv_task => r,
    };
}

fn handle_abc_message(
    sm: &crate::session_manager::SessionManager,
    abc_id: &str,
    text: &str,
) {
    let msg: SignalingMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Invalid ABC message: {}", e);
            return;
        }
    };

    match msg {
        SignalingMessage::Offer { sdp } => {
            sm.send(SessionCommand::AbcOffer {
                abc_id: abc_id.to_string(),
                sdp,
            });
        }
        SignalingMessage::IceCandidate {
            candidate,
            sdp_mid,
            sdp_m_line_index,
        } => {
            sm.send(SessionCommand::AbcIceCandidate {
                abc_id: abc_id.to_string(),
                candidate,
                sdp_mid,
                sdp_m_line_index,
            });
        }
        SignalingMessage::Pong => {}
        _ => {
            tracing::debug!("Unhandled ABC message: {:?}", msg);
        }
    }
}

pub async fn ws_translator(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<WsAuthQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let token = query
        .token
        .ok_or_else(|| AppError::Unauthorized("Missing token query parameter".to_string()))?;

    let _claims = auth::validate_access_token(&token, &state.config.auth.jwt_secret)
        .map_err(|_| AppError::Unauthorized("Invalid or expired token".to_string()))?;

    let conn = state
        .db
        .conn()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (abc_id, session_name): (String, String) = conn
        .query_row(
            "SELECT abc_id, session_name FROM sessions WHERE id = ?1",
            [&session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| AppError::NotFound("Session not found".to_string()))?;

    let session_mgr = state.session_manager.clone();
    let sid = session_id.clone();
    let sname = session_name.clone();

    Ok(ws.on_upgrade(move |socket| {
        handle_translator_ws(socket, session_mgr, sid, sname, abc_id)
    }))
}

async fn handle_translator_ws(
    socket: WebSocket,
    session_mgr: crate::session_manager::SessionManager,
    session_id: String,
    session_name: String,
    abc_id: String,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<SignalingMessage>();

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    session_mgr.send(SessionCommand::StartSession {
        session_id: session_id.clone(),
        session_name,
        abc_id,
        translator_ws_tx: tx.clone(),
        reply: reply_tx,
    });

    match reply_rx.await {
        Ok(Ok(())) => {
            let _ = tx.send(SignalingMessage::Welcome {
                session_id: Some(session_id.clone()),
                abc_id: None,
            });
        }
        Ok(Err(e)) => {
            let _ = tx.send(SignalingMessage::Error {
                code: "session_start_failed".to_string(),
                message: e.to_string(),
            });
            return;
        }
        Err(_) => return,
    }

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(_) => continue,
            };
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    let sm = session_mgr.clone();
    let sid = session_id.clone();
    let recv_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            handle_translator_message(&sm, &sid, &text);
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    let _ = tx.send(SignalingMessage::Ping);
                }
            }
        }
        sm.send(SessionCommand::TranslatorDisconnected {
            session_id: sid,
        });
    });

    let _ = tokio::select! {
        r = send_task => r,
        r = recv_task => r,
    };
}

fn handle_translator_message(
    sm: &crate::session_manager::SessionManager,
    session_id: &str,
    text: &str,
) {
    let msg: SignalingMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Invalid translator message: {}", e);
            return;
        }
    };

    match msg {
        SignalingMessage::Offer { sdp } => {
            sm.send(SessionCommand::TranslatorOffer {
                session_id: session_id.to_string(),
                sdp,
            });
        }
        SignalingMessage::IceCandidate {
            candidate,
            sdp_mid,
            sdp_m_line_index,
        } => {
            sm.send(SessionCommand::TranslatorIceCandidate {
                session_id: session_id.to_string(),
                candidate,
                sdp_mid,
                sdp_m_line_index,
            });
        }
        SignalingMessage::Mute { muted } => {
            sm.send(SessionCommand::HandleMute {
                session_id: session_id.to_string(),
                muted,
            });
        }
        SignalingMessage::Passthrough { enabled } => {
            sm.send(SessionCommand::HandlePassthrough {
                session_id: session_id.to_string(),
                enabled,
            });
        }
        SignalingMessage::Pong => {}
        _ => {
            tracing::debug!("Unhandled translator message: {:?}", msg);
        }
    }
}

pub async fn ws_listener(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<WsAuthQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let conn = state
        .db
        .conn()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let session_pin: Option<String> = conn
        .query_row(
            "SELECT pin FROM sessions WHERE id = ?1",
            [&session_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound("Session not found".to_string()))?;

    if let Some(pin) = &session_pin {
        if !pin.is_empty() {
            let provided_pin = query.pin.as_deref().unwrap_or("");
            if provided_pin != pin {
                return Err(AppError::Unauthorized("Invalid PIN".to_string()));
            }
        }
    }

    let session_mgr = state.session_manager.clone();
    let sid = session_id.clone();

    Ok(ws.on_upgrade(move |socket| handle_listener_ws(socket, session_mgr, sid)))
}

async fn handle_listener_ws(
    socket: WebSocket,
    session_mgr: crate::session_manager::SessionManager,
    session_id: String,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<SignalingMessage>();

    let listener_id = uuid::Uuid::new_v4().to_string();

    session_mgr.send(SessionCommand::AddListener {
        session_id: session_id.clone(),
        listener_id: listener_id.clone(),
        ws_tx: tx.clone(),
    });

    let _ = tx.send(SignalingMessage::Welcome {
        session_id: Some(session_id.clone()),
        abc_id: None,
    });

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(_) => continue,
            };
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    let sm = session_mgr.clone();
    let sid = session_id.clone();
    let lid = listener_id.clone();
    let recv_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            handle_listener_message(&sm, &sid, &lid, &text);
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    let _ = tx.send(SignalingMessage::Ping);
                }
            }
        }
        sm.send(SessionCommand::RemoveListener {
            session_id: sid,
            listener_id: lid,
        });
    });

    let _ = tokio::select! {
        r = send_task => r,
        r = recv_task => r,
    };
}

fn handle_listener_message(
    sm: &crate::session_manager::SessionManager,
    session_id: &str,
    listener_id: &str,
    text: &str,
) {
    let msg: SignalingMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Invalid listener message: {}", e);
            return;
        }
    };

    match msg {
        SignalingMessage::Offer { sdp } => {
            sm.send(SessionCommand::ListenerOffer {
                session_id: session_id.to_string(),
                listener_id: listener_id.to_string(),
                sdp,
            });
        }
        SignalingMessage::IceCandidate {
            candidate,
            sdp_mid,
            sdp_m_line_index,
        } => {
            sm.send(SessionCommand::ListenerIceCandidate {
                session_id: session_id.to_string(),
                listener_id: listener_id.to_string(),
                candidate,
                sdp_mid,
                sdp_m_line_index,
            });
        }
        SignalingMessage::Pong => {}
        _ => {
            tracing::debug!("Unhandled listener message: {:?}", msg);
        }
    }
}
