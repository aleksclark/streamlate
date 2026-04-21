use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot};

use str0m::media::{Direction, Mid};

use crate::config::RecordingConfig;
use crate::recording::metadata::RecordingEvent;
use crate::recording::session_recorder::{SessionRecorderConfig, SessionRecorderHandle, start_session_recorder};
use crate::sfu_loop::{MediaRoute, PeerId, PeerRole, SfuCommand, SfuEvent};
use crate::signaling::SignalingMessage;

#[derive(Debug)]
pub enum SessionCommand {
    StartSession {
        session_id: String,
        session_name: String,
        abc_id: String,
        translator_ws_tx: mpsc::UnboundedSender<SignalingMessage>,
        reply: tokio::sync::oneshot::Sender<anyhow::Result<()>>,
    },
    StopSession {
        session_id: String,
    },
    AbcConnected {
        abc_id: String,
        ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    },
    AbcDisconnected {
        abc_id: String,
    },
    AbcOffer {
        abc_id: String,
        sdp: String,
    },
    AbcIceCandidate {
        abc_id: String,
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
    TranslatorOffer {
        session_id: String,
        sdp: String,
    },
    TranslatorIceCandidate {
        session_id: String,
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
    TranslatorDisconnected {
        session_id: String,
    },
    AddListener {
        session_id: String,
        listener_id: String,
        ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    },
    ListenerOffer {
        session_id: String,
        listener_id: String,
        sdp: String,
    },
    ListenerIceCandidate {
        session_id: String,
        listener_id: String,
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
    RemoveListener {
        session_id: String,
        listener_id: String,
    },
    HandleMute {
        session_id: String,
        muted: bool,
    },
    HandlePassthrough {
        session_id: String,
        enabled: bool,
    },
    GetHealthStats {
        session_id: String,
        reply: tokio::sync::oneshot::Sender<Option<HealthStats>>,
    },
    GetAbcStatus {
        abc_id: String,
        reply: tokio::sync::oneshot::Sender<bool>,
    },
    GetConnectedAbcCount {
        reply: tokio::sync::oneshot::Sender<usize>,
    },
    AbcLogMessage {
        abc_id: String,
        level: String,
        target: String,
        message: String,
    },
    AbcIceRestart {
        abc_id: String,
    },
    TranslatorIceRestart {
        session_id: String,
    },
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct PeerStats {
    pub ice_connection_state: String,
    pub ice_gathering_state: String,
    pub dtls_state: String,
    pub signaling_state: String,

    pub local_candidate_type: String,
    pub remote_candidate_type: String,
    pub local_address: String,
    pub remote_address: String,
    pub transport_protocol: String,

    pub codec: String,
    pub sample_rate: u32,
    pub channels: u16,

    pub packets_sent: u64,
    pub packets_received: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub nack_count: u64,

    pub round_trip_time_ms: f64,
    pub jitter_ms: f64,
    pub packet_loss_pct: f64,
    pub bitrate_kbps: f64,
}

#[derive(Debug, Clone, Default)]
pub struct HealthStats {
    pub latency_ms: f64,
    pub packet_loss: f64,
    pub jitter_ms: f64,
    pub bitrate_kbps: f64,
}

// ---------------------------------------------------------------------------
// Per-peer data structures (no more Arc<RTCPeerConnection>)
// ---------------------------------------------------------------------------

struct AbcConnection {
    ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    /// SFU loop peer id (set after first offer)
    peer_id: Option<PeerId>,
    active_session_id: Option<String>,
    /// Receive-direction mid discovered via SfuEvent::MediaAdded
    recv_mid: Option<Mid>,
    /// Send-direction mid discovered via SfuEvent::MediaAdded
    send_mid: Option<Mid>,
}

struct ListenerConnection {
    _ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    /// SFU loop peer id
    peer_id: Option<PeerId>,
    /// Send-direction mid (for receiving translated audio from translator)
    send_mid: Option<Mid>,
}

struct ActiveSession {
    #[allow(dead_code)]
    session_id: String,
    _session_name: String,
    abc_id: String,
    translator_ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    /// SFU loop peer id for the translator
    translator_peer_id: Option<PeerId>,
    /// Translator's receive-direction mid
    translator_recv_mid: Option<Mid>,
    /// Translator's send-direction mid
    translator_send_mid: Option<Mid>,
    listeners: HashMap<String, ListenerConnection>,
    muted: std::sync::Arc<AtomicBool>,
    #[allow(dead_code)]
    passthrough: bool,
    health: HealthStats,
    last_health_check: Instant,
    started_at: Instant,
    recorder: Option<SessionRecorderHandle>,
    /// Whether bidirectional routes between ABC and translator have been set up
    routes_established: bool,
}

impl ActiveSession {
    fn debug_log(&self, source: &str, event: &str, detail: &str) {
        tracing::debug!(source, event, detail, "session debug log");
    }
}

#[allow(dead_code)]
fn send_debug_log(
    _tx: &mpsc::UnboundedSender<SignalingMessage>,
    _started_at: Instant,
    source: &str,
    event: &str,
    detail: &str,
) {
    tracing::debug!(source, event, detail, "session debug log");
}

// ---------------------------------------------------------------------------
// Public handle (cheaply cloneable)
// ---------------------------------------------------------------------------

pub struct SessionManager {
    cmd_tx: mpsc::UnboundedSender<SessionCommand>,
}

impl Clone for SessionManager {
    fn clone(&self) -> Self {
        SessionManager {
            cmd_tx: self.cmd_tx.clone(),
        }
    }
}

impl SessionManager {
    pub fn new(
        db: crate::db::Database,
        recording_config: RecordingConfig,
        sfu_cmd_tx: mpsc::UnboundedSender<SfuCommand>,
        sfu_event_rx: mpsc::UnboundedReceiver<SfuEvent>,
    ) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let mgr = SessionManagerActor {
            abcs: HashMap::new(),
            sessions: HashMap::new(),
            db,
            recording_config,
            sfu_cmd_tx,
            sfu_event_rx,
            // Reverse lookup: PeerId → (abc_id | session_id, role)
            peer_lookup: HashMap::new(),
        };
        tokio::spawn(mgr.run(cmd_rx));
        SessionManager { cmd_tx }
    }

    pub fn send(&self, cmd: SessionCommand) {
        let _ = self.cmd_tx.send(cmd);
    }

    pub async fn get_abc_status(&self, abc_id: &str) -> bool {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = self.cmd_tx.send(SessionCommand::GetAbcStatus {
            abc_id: abc_id.to_string(),
            reply: tx,
        });
        rx.await.unwrap_or(false)
    }

    pub async fn get_health_stats(&self, session_id: &str) -> Option<HealthStats> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = self.cmd_tx.send(SessionCommand::GetHealthStats {
            session_id: session_id.to_string(),
            reply: tx,
        });
        rx.await.unwrap_or(None)
    }

    pub async fn get_connected_abc_count(&self) -> usize {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = self.cmd_tx.send(SessionCommand::GetConnectedAbcCount { reply: tx });
        rx.await.unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// Peer lookup info
// ---------------------------------------------------------------------------

/// Tracks what role a PeerId plays so we can dispatch SfuEvents back to the
/// right ABC / session / listener.
#[derive(Debug, Clone)]
enum PeerOwner {
    /// ABC peer — keyed by abc_id
    Abc { abc_id: String },
    /// Translator peer — keyed by session_id
    Translator { session_id: String },
    /// Listener peer — keyed by (session_id, listener_id)
    Listener {
        session_id: String,
        listener_id: String,
    },
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

struct SessionManagerActor {
    abcs: HashMap<String, AbcConnection>,
    sessions: HashMap<String, ActiveSession>,
    db: crate::db::Database,
    recording_config: RecordingConfig,
    sfu_cmd_tx: mpsc::UnboundedSender<SfuCommand>,
    sfu_event_rx: mpsc::UnboundedReceiver<SfuEvent>,
    /// Reverse lookup: PeerId → owner info
    peer_lookup: HashMap<PeerId, PeerOwner>,
}

impl SessionManagerActor {
    async fn run(mut self, mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>) {
        let health_interval = tokio::time::interval(std::time::Duration::from_secs(5));
        tokio::pin!(health_interval);

        loop {
            tokio::select! {
                Some(cmd) = cmd_rx.recv() => {
                    self.handle_command(cmd).await;
                }
                Some(event) = self.sfu_event_rx.recv() => {
                    self.handle_sfu_event(event).await;
                }
                _ = health_interval.tick() => {
                    self.collect_health_stats().await;
                }
            }
        }
    }

    async fn handle_command(&mut self, cmd: SessionCommand) {
        match cmd {
            SessionCommand::AbcConnected { abc_id, ws_tx } => {
                tracing::info!("ABC connected: {}", abc_id);
                self.abcs.insert(
                    abc_id,
                    AbcConnection {
                        ws_tx,
                        peer_id: None,
                        active_session_id: None,
                        recv_mid: None,
                        send_mid: None,
                    },
                );
            }
            SessionCommand::AbcDisconnected { abc_id } => {
                tracing::info!("ABC disconnected: {}", abc_id);
                if let Some(abc) = self.abcs.remove(&abc_id) {
                    // Remove the peer from the SFU loop
                    if let Some(pid) = abc.peer_id {
                        let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                        self.peer_lookup.remove(&pid);
                    }
                    if let Some(session_id) = abc.active_session_id {
                        self.teardown_session(&session_id).await;
                    }
                }
            }
            SessionCommand::StartSession {
                session_id,
                session_name,
                abc_id,
                translator_ws_tx,
                reply,
            } => {
                let result = self
                    .start_session(session_id, session_name, abc_id, translator_ws_tx)
                    .await;
                let _ = reply.send(result);
            }
            SessionCommand::StopSession { session_id } => {
                self.teardown_session(&session_id).await;
            }
            SessionCommand::AbcOffer { abc_id, sdp } => {
                self.handle_abc_offer(&abc_id, &sdp).await;
            }
            SessionCommand::AbcIceCandidate {
                abc_id,
                candidate,
                sdp_mid: _,
                sdp_m_line_index: _,
            } => {
                self.handle_abc_ice(&abc_id, &candidate).await;
            }
            SessionCommand::TranslatorOffer { session_id, sdp } => {
                self.handle_translator_offer(&session_id, &sdp).await;
            }
            SessionCommand::TranslatorIceCandidate {
                session_id,
                candidate,
                sdp_mid: _,
                sdp_m_line_index: _,
            } => {
                self.handle_translator_ice(&session_id, &candidate).await;
            }
            SessionCommand::TranslatorDisconnected { session_id } => {
                tracing::info!(
                    "Translator disconnected from session: {} — cleaning up",
                    session_id
                );
                self.teardown_session(&session_id).await;
            }
            SessionCommand::AddListener {
                session_id,
                listener_id,
                ws_tx,
            } => {
                self.add_listener(&session_id, &listener_id, ws_tx).await;
            }
            SessionCommand::ListenerOffer {
                session_id,
                listener_id,
                sdp,
            } => {
                self.handle_listener_offer(&session_id, &listener_id, &sdp)
                    .await;
            }
            SessionCommand::ListenerIceCandidate {
                session_id,
                listener_id,
                candidate,
                sdp_mid: _,
                sdp_m_line_index: _,
            } => {
                self.handle_listener_ice(&session_id, &listener_id, &candidate)
                    .await;
            }
            SessionCommand::RemoveListener {
                session_id,
                listener_id,
            } => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    if let Some(listener) = session.listeners.remove(&listener_id) {
                        if let Some(pid) = listener.peer_id {
                            let _ =
                                self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                            self.peer_lookup.remove(&pid);
                        }
                    }
                }
            }
            SessionCommand::HandleMute { session_id, muted } => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    session.muted.store(muted, Ordering::Relaxed);
                    tracing::info!("Session {} muted={}", session_id, muted);
                    if let Some(recorder) = &session.recorder {
                        let event_type = if muted { "mute" } else { "unmute" };
                        recorder.send_event(RecordingEvent {
                            time: session.started_at.elapsed().as_secs_f64(),
                            event_type: event_type.to_string(),
                            value: Some(serde_json::Value::Bool(muted)),
                        });
                    }
                }
            }
            SessionCommand::HandlePassthrough {
                session_id,
                enabled,
            } => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    session.passthrough = enabled;
                    tracing::info!("Session {} passthrough={}", session_id, enabled);
                    if let Some(recorder) = &session.recorder {
                        let event_type = if enabled {
                            "passthrough_on"
                        } else {
                            "passthrough_off"
                        };
                        recorder.send_event(RecordingEvent {
                            time: session.started_at.elapsed().as_secs_f64(),
                            event_type: event_type.to_string(),
                            value: Some(serde_json::Value::Bool(enabled)),
                        });
                    }
                }
            }
            SessionCommand::GetHealthStats { session_id, reply } => {
                let stats = self.sessions.get(&session_id).map(|s| s.health.clone());
                let _ = reply.send(stats);
            }
            SessionCommand::GetAbcStatus { abc_id, reply } => {
                let online = self.abcs.contains_key(&abc_id);
                let _ = reply.send(online);
            }
            SessionCommand::GetConnectedAbcCount { reply } => {
                let _ = reply.send(self.abcs.len());
            }
            SessionCommand::AbcLogMessage {
                abc_id,
                level,
                target,
                message,
            } => {
                if let Some(abc) = self.abcs.get(&abc_id) {
                    if let Some(session_id) = &abc.active_session_id {
                        if let Some(session) = self.sessions.get(session_id) {
                            session.debug_log(
                                "abc-device",
                                &level,
                                &format!("[{}] {}", target, message),
                            );
                        }
                    }
                }
            }
            SessionCommand::AbcIceRestart { abc_id } => {
                tracing::info!("ICE restart requested by ABC {}", abc_id);
                if let Some(abc) = self.abcs.get(&abc_id) {
                    if let Some(session_id) = abc.active_session_id.clone() {
                        self.handle_abc_ice_restart(&abc_id, &session_id).await;
                    }
                }
            }
            SessionCommand::TranslatorIceRestart { session_id } => {
                tracing::info!(
                    "ICE restart requested by translator for session {}",
                    session_id
                );
                self.handle_translator_ice_restart(&session_id).await;
            }
        }
    }

    // -----------------------------------------------------------------------
    // SFU event handling
    // -----------------------------------------------------------------------

    async fn handle_sfu_event(&mut self, event: SfuEvent) {
        match event {
            SfuEvent::MediaAdded {
                peer_id,
                mid,
                kind: _,
                direction,
            } => {
                self.handle_media_added(peer_id, mid, direction).await;
            }
            SfuEvent::IceStateChanged { peer_id, state } => {
                tracing::debug!("SFU ICE state change: {} -> {:?}", peer_id, state);
                // Could send debug logs to translator ws here if desired
            }
            SfuEvent::PeerDisconnected { peer_id } => {
                tracing::info!("SFU peer disconnected: {}", peer_id);
                self.peer_lookup.remove(&peer_id);
                // The SFU loop already cleaned up routes. We could trigger
                // session teardown here, but typically the WebSocket disconnect
                // handler already does that.
            }
            SfuEvent::MediaReceived {
                peer_id: _,
                mid: _,
                kind: _,
            } => {
                // Recording hooks would go here in the future.
                // For now, the SFU loop handles all media routing internally.
            }
        }
    }

    /// Called when the SFU loop reports a new media track on a peer.
    /// We record the mid and, once both ABC and translator have their mids,
    /// set up bidirectional routes.
    async fn handle_media_added(&mut self, peer_id: PeerId, mid: Mid, direction: Direction) {
        let owner = match self.peer_lookup.get(&peer_id) {
            Some(o) => o.clone(),
            None => return,
        };

        match owner {
            PeerOwner::Abc { ref abc_id } => {
                if let Some(abc) = self.abcs.get_mut(abc_id) {
                    // is_receiving means the SFU receives from this peer (peer sends)
                    if direction.is_receiving() {
                        abc.recv_mid = Some(mid);
                        tracing::debug!("ABC {} recv_mid set to {}", abc_id, mid);
                    }
                    if direction.is_sending() {
                        abc.send_mid = Some(mid);
                        tracing::debug!("ABC {} send_mid set to {}", abc_id, mid);
                    }
                }
                // Try to establish routes
                if let Some(abc) = self.abcs.get(abc_id) {
                    if let Some(session_id) = abc.active_session_id.clone() {
                        self.try_establish_routes(&session_id);
                    }
                }
            }
            PeerOwner::Translator { ref session_id } => {
                if let Some(session) = self.sessions.get_mut(session_id) {
                    if direction.is_receiving() {
                        session.translator_recv_mid = Some(mid);
                        tracing::debug!("Translator {} recv_mid set to {}", session_id, mid);
                    }
                    if direction.is_sending() {
                        session.translator_send_mid = Some(mid);
                        tracing::debug!("Translator {} send_mid set to {}", session_id, mid);
                    }
                }
                // Try to establish routes
                self.try_establish_routes(session_id);
            }
            PeerOwner::Listener {
                ref session_id,
                ref listener_id,
            } => {
                if let Some(session) = self.sessions.get_mut(session_id) {
                    if let Some(listener) = session.listeners.get_mut(listener_id) {
                        if direction.is_sending() {
                            listener.send_mid = Some(mid);
                            tracing::debug!(
                                "Listener {}/{} send_mid set to {}",
                                session_id,
                                listener_id,
                                mid
                            );
                        }
                    }
                }
                // Set up translator → listener route
                self.try_establish_listener_route(session_id, listener_id);
            }
        }
    }

    /// When both ABC and translator have their mids, set up bidirectional routes:
    /// - ABC recv_mid → translator send_mid (booth audio to translator)
    /// - Translator recv_mid → ABC send_mid (translated audio back to booth)
    fn try_establish_routes(&mut self, session_id: &str) {
        let session = match self.sessions.get(session_id) {
            Some(s) => s,
            None => return,
        };

        if session.routes_established {
            return;
        }

        let abc = match self.abcs.get(&session.abc_id) {
            Some(a) => a,
            None => return,
        };

        // Need all four mids + both peer IDs
        let abc_peer_id = match abc.peer_id {
            Some(p) => p,
            None => return,
        };
        let abc_recv_mid = match abc.recv_mid {
            Some(m) => m,
            None => return,
        };
        let abc_send_mid = match abc.send_mid {
            Some(m) => m,
            None => return,
        };
        let translator_peer_id = match session.translator_peer_id {
            Some(p) => p,
            None => return,
        };
        let translator_recv_mid = match session.translator_recv_mid {
            Some(m) => m,
            None => return,
        };
        let translator_send_mid = match session.translator_send_mid {
            Some(m) => m,
            None => return,
        };

        tracing::info!(
            "Setting up routes for session {}: ABC({}) recv={} send={} <-> Translator({}) recv={} send={}",
            session_id,
            abc_peer_id, abc_recv_mid, abc_send_mid,
            translator_peer_id, translator_recv_mid, translator_send_mid,
        );

        // ABC recv → Translator send (booth audio to translator)
        let _ = self.sfu_cmd_tx.send(SfuCommand::SetRoute {
            source_peer: abc_peer_id,
            source_mid: abc_recv_mid,
            routes: vec![MediaRoute {
                dest_peer: translator_peer_id,
                dest_mid: translator_send_mid,
            }],
        });

        // Translator recv → ABC send (translated audio back to booth)
        let _ = self.sfu_cmd_tx.send(SfuCommand::SetRoute {
            source_peer: translator_peer_id,
            source_mid: translator_recv_mid,
            routes: vec![MediaRoute {
                dest_peer: abc_peer_id,
                dest_mid: abc_send_mid,
            }],
        });

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.routes_established = true;
            session.debug_log("server", "routes_established", "abc<->translator");
        }

        // Also set up routes for any listeners that are already waiting
        let listener_ids: Vec<String> = self
            .sessions
            .get(session_id)
            .map(|s| s.listeners.keys().cloned().collect())
            .unwrap_or_default();
        for lid in listener_ids {
            self.try_establish_listener_route(session_id, &lid);
        }
    }

    /// Set up translator → listener route (one-directional: listener receives translated audio)
    fn try_establish_listener_route(&mut self, session_id: &str, listener_id: &str) {
        let session = match self.sessions.get(session_id) {
            Some(s) => s,
            None => return,
        };

        let translator_peer_id = match session.translator_peer_id {
            Some(p) => p,
            None => return,
        };
        let translator_recv_mid = match session.translator_recv_mid {
            Some(m) => m,
            None => return,
        };

        let listener = match session.listeners.get(listener_id) {
            Some(l) => l,
            None => return,
        };

        let listener_peer_id = match listener.peer_id {
            Some(p) => p,
            None => return,
        };
        let listener_send_mid = match listener.send_mid {
            Some(m) => m,
            None => return,
        };

        tracing::info!(
            "Setting up listener route for {}/{}: Translator({}) recv={} -> Listener({}) send={}",
            session_id,
            listener_id,
            translator_peer_id,
            translator_recv_mid,
            listener_peer_id,
            listener_send_mid,
        );

        // Translator recv → Listener send (translated audio to listener)
        // NOTE: We append to the existing route rather than replacing it.
        // The SfuCommand::SetRoute replaces the entire route list for a (source, mid) pair,
        // so we need to include all existing destinations.
        // For simplicity, we send a new SetRoute that includes the listener.
        // This means we need to re-set the route for translator_recv_mid with all destinations.

        // Gather all destinations for this translator recv mid
        let abc = self.abcs.get(&session.abc_id);
        let mut routes = Vec::new();

        // ABC send mid (the main bidirectional route)
        if let Some(abc) = abc {
            if let Some(abc_peer_id) = abc.peer_id {
                if let Some(abc_send_mid) = abc.send_mid {
                    routes.push(MediaRoute {
                        dest_peer: abc_peer_id,
                        dest_mid: abc_send_mid,
                    });
                }
            }
        }

        // All listeners
        for (_, listener) in &session.listeners {
            if let (Some(pid), Some(smid)) = (listener.peer_id, listener.send_mid) {
                routes.push(MediaRoute {
                    dest_peer: pid,
                    dest_mid: smid,
                });
            }
        }

        let _ = self.sfu_cmd_tx.send(SfuCommand::SetRoute {
            source_peer: translator_peer_id,
            source_mid: translator_recv_mid,
            routes,
        });
    }

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    async fn start_session(
        &mut self,
        session_id: String,
        session_name: String,
        abc_id: String,
        translator_ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    ) -> anyhow::Result<()> {
        let abc = self
            .abcs
            .get_mut(&abc_id)
            .ok_or_else(|| anyhow::anyhow!("ABC not connected"))?;

        let _ = abc.ws_tx.send(SignalingMessage::SessionStart {
            session_id: session_id.clone(),
            session_name: session_name.clone(),
        });
        abc.active_session_id = Some(session_id.clone());

        let recorder = match start_session_recorder(SessionRecorderConfig {
            session_id: session_id.clone(),
            session_name: session_name.clone(),
            translator_id: String::new(),
            translator_name: String::new(),
            abc_id: abc_id.clone(),
            abc_name: String::new(),
            recording_path: std::path::PathBuf::from(&self.recording_config.path),
            flush_pages: self.recording_config.flush_pages,
            db: self.db.clone(),
        }) {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::error!(
                    "Failed to start recording for session {}: {}",
                    session_id,
                    e
                );
                None
            }
        };

        let session = ActiveSession {
            session_id: session_id.clone(),
            _session_name: session_name,
            abc_id,
            translator_ws_tx,
            translator_peer_id: None,
            translator_recv_mid: None,
            translator_send_mid: None,
            listeners: HashMap::new(),
            muted: std::sync::Arc::new(AtomicBool::new(false)),
            passthrough: false,
            health: HealthStats::default(),
            last_health_check: Instant::now(),
            started_at: Instant::now(),
            recorder,
            routes_established: false,
        };

        // Clean up existing session before inserting new one
        if let Some(mut old) = self.sessions.remove(&session_id) {
            tracing::warn!(
                "Session {} already exists, replacing old session",
                session_id
            );

            // Notify old translator
            let _ = old.translator_ws_tx.send(SignalingMessage::SessionStop {
                session_id: session_id.clone(),
            });

            // Remove old translator peer from SFU
            if let Some(pid) = old.translator_peer_id {
                let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                self.peer_lookup.remove(&pid);
            }

            // Remove old ABC peer from SFU
            if let Some(abc) = self.abcs.get_mut(&old.abc_id) {
                if let Some(pid) = abc.peer_id.take() {
                    let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                    self.peer_lookup.remove(&pid);
                }
                abc.recv_mid = None;
                abc.send_mid = None;
            }

            // Stop old recorder
            if let Some(recorder) = old.recorder.take() {
                recorder.stop();
            }

            // Remove old listener peers from SFU
            for (_, listener) in old.listeners.drain() {
                if let Some(pid) = listener.peer_id {
                    let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                    self.peer_lookup.remove(&pid);
                }
            }
        }

        self.sessions.insert(session_id.clone(), session);

        if let Some(s) = self.sessions.get(&session_id) {
            s.debug_log(
                "server",
                "session_started",
                &format!("abc_id={}", s.abc_id),
            );
        }

        if let Err(e) = self.update_session_state(&session_id, "active") {
            tracing::error!("Failed to update session state: {}", e);
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Offer handling — sends SfuCommand::AcceptOffer, awaits reply
    // -----------------------------------------------------------------------

    async fn handle_abc_offer(&mut self, abc_id: &str, sdp: &str) {
        let session_id = match self.abcs.get(abc_id) {
            Some(a) => match &a.active_session_id {
                Some(s) => s.clone(),
                None => return,
            },
            None => return,
        };

        if let Some(s) = self.sessions.get(&session_id) {
            s.debug_log(
                "abc",
                "offer_received",
                &format!("abc_id={}, sdp_len={}", abc_id, sdp.len()),
            );
        }

        // Remove old ABC peer if re-offer
        if let Some(abc) = self.abcs.get_mut(abc_id) {
            if let Some(old_pid) = abc.peer_id.take() {
                tracing::info!("Removing old ABC peer {} on re-offer", old_pid);
                let _ = self
                    .sfu_cmd_tx
                    .send(SfuCommand::RemovePeer { peer_id: old_pid });
                self.peer_lookup.remove(&old_pid);
                abc.recv_mid = None;
                abc.send_mid = None;
            }
        }

        // Reset routes flag since we're creating a new peer
        if let Some(session) = self.sessions.get_mut(&session_id) {
            session.routes_established = false;
        }

        let peer_id = PeerId::next();
        let (reply_tx, reply_rx) = oneshot::channel();

        let _ = self.sfu_cmd_tx.send(SfuCommand::AcceptOffer {
            peer_id,
            role: PeerRole::Abc,
            offer_sdp: sdp.to_string(),
            reply: reply_tx,
        });

        let answer_sdp = match reply_rx.await {
            Ok(Ok(sdp)) => sdp,
            Ok(Err(e)) => {
                tracing::error!("SFU failed to accept ABC offer: {}", e);
                return;
            }
            Err(_) => {
                tracing::error!("SFU reply channel dropped for ABC offer");
                return;
            }
        };

        // Store peer_id and send answer
        if let Some(abc) = self.abcs.get_mut(abc_id) {
            abc.peer_id = Some(peer_id);
            let _ = abc.ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });
        }

        self.peer_lookup.insert(
            peer_id,
            PeerOwner::Abc {
                abc_id: abc_id.to_string(),
            },
        );
    }

    async fn handle_abc_ice(&mut self, abc_id: &str, candidate: &str) {
        if candidate.is_empty() {
            return;
        }
        if let Some(abc) = self.abcs.get(abc_id) {
            if let Some(peer_id) = abc.peer_id {
                let _ = self.sfu_cmd_tx.send(SfuCommand::AddIceCandidate {
                    peer_id,
                    candidate: candidate.to_string(),
                });
            } else {
                tracing::debug!("No ABC peer_id yet for {}, dropping ICE candidate", abc_id);
            }
        }
    }

    async fn handle_translator_offer(&mut self, session_id: &str, sdp: &str) {
        if let Some(s) = self.sessions.get(session_id) {
            s.debug_log(
                "translator",
                "offer_received",
                &format!("sdp_len={}", sdp.len()),
            );
        }

        // Remove old translator peer if re-offer
        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(old_pid) = session.translator_peer_id.take() {
                tracing::info!("Removing old translator peer {} on re-offer", old_pid);
                let _ = self
                    .sfu_cmd_tx
                    .send(SfuCommand::RemovePeer { peer_id: old_pid });
                self.peer_lookup.remove(&old_pid);
                session.translator_recv_mid = None;
                session.translator_send_mid = None;
                session.routes_established = false;
            }
        }

        let translator_ws_tx = match self.sessions.get(session_id) {
            Some(s) => s.translator_ws_tx.clone(),
            None => return,
        };

        let peer_id = PeerId::next();
        let (reply_tx, reply_rx) = oneshot::channel();

        let _ = self.sfu_cmd_tx.send(SfuCommand::AcceptOffer {
            peer_id,
            role: PeerRole::Translator,
            offer_sdp: sdp.to_string(),
            reply: reply_tx,
        });

        let answer_sdp = match reply_rx.await {
            Ok(Ok(sdp)) => sdp,
            Ok(Err(e)) => {
                tracing::error!("SFU failed to accept translator offer: {}", e);
                return;
            }
            Err(_) => {
                tracing::error!("SFU reply channel dropped for translator offer");
                return;
            }
        };

        let _ = translator_ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.translator_peer_id = Some(peer_id);
        }

        self.peer_lookup.insert(
            peer_id,
            PeerOwner::Translator {
                session_id: session_id.to_string(),
            },
        );
    }

    async fn handle_translator_ice(&mut self, session_id: &str, candidate: &str) {
        if candidate.is_empty() {
            return;
        }
        if let Some(session) = self.sessions.get(session_id) {
            if let Some(peer_id) = session.translator_peer_id {
                let _ = self.sfu_cmd_tx.send(SfuCommand::AddIceCandidate {
                    peer_id,
                    candidate: candidate.to_string(),
                });
            } else {
                tracing::debug!(
                    "No translator peer_id yet for session {}, dropping ICE candidate",
                    session_id
                );
            }
        }
    }

    async fn add_listener(
        &mut self,
        session_id: &str,
        listener_id: &str,
        ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    ) {
        if !self.sessions.contains_key(session_id) {
            return;
        }

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.listeners.insert(
                listener_id.to_string(),
                ListenerConnection {
                    _ws_tx: ws_tx,
                    peer_id: None,
                    send_mid: None,
                },
            );
        }
    }

    async fn handle_listener_offer(
        &mut self,
        session_id: &str,
        listener_id: &str,
        sdp: &str,
    ) {
        let ws_tx = {
            let session = match self.sessions.get(session_id) {
                Some(s) => s,
                None => return,
            };

            let listener = match session.listeners.get(listener_id) {
                Some(l) => l,
                None => return,
            };

            listener._ws_tx.clone()
        };

        // Remove old listener peer if re-offer
        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(listener) = session.listeners.get_mut(listener_id) {
                if let Some(old_pid) = listener.peer_id.take() {
                    let _ = self
                        .sfu_cmd_tx
                        .send(SfuCommand::RemovePeer { peer_id: old_pid });
                    self.peer_lookup.remove(&old_pid);
                    listener.send_mid = None;
                }
            }
        }

        let peer_id = PeerId::next();
        let (reply_tx, reply_rx) = oneshot::channel();

        let _ = self.sfu_cmd_tx.send(SfuCommand::AcceptOffer {
            peer_id,
            role: PeerRole::Listener,
            offer_sdp: sdp.to_string(),
            reply: reply_tx,
        });

        let answer_sdp = match reply_rx.await {
            Ok(Ok(sdp)) => sdp,
            Ok(Err(e)) => {
                tracing::error!("SFU failed to accept listener offer: {}", e);
                return;
            }
            Err(_) => {
                tracing::error!("SFU reply channel dropped for listener offer");
                return;
            }
        };

        let _ = ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });

        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(listener) = session.listeners.get_mut(listener_id) {
                listener.peer_id = Some(peer_id);
            }
        }

        self.peer_lookup.insert(
            peer_id,
            PeerOwner::Listener {
                session_id: session_id.to_string(),
                listener_id: listener_id.to_string(),
            },
        );
    }

    async fn handle_listener_ice(
        &mut self,
        session_id: &str,
        listener_id: &str,
        candidate: &str,
    ) {
        if candidate.is_empty() {
            return;
        }
        if let Some(session) = self.sessions.get(session_id) {
            if let Some(listener) = session.listeners.get(listener_id) {
                if let Some(peer_id) = listener.peer_id {
                    let _ = self.sfu_cmd_tx.send(SfuCommand::AddIceCandidate {
                        peer_id,
                        candidate: candidate.to_string(),
                    });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // ICE restart
    // -----------------------------------------------------------------------

    async fn handle_abc_ice_restart(&mut self, abc_id: &str, session_id: &str) {
        // Remove the old peer from SFU
        if let Some(abc) = self.abcs.get_mut(abc_id) {
            if let Some(old_pid) = abc.peer_id.take() {
                let _ = self
                    .sfu_cmd_tx
                    .send(SfuCommand::RemovePeer { peer_id: old_pid });
                self.peer_lookup.remove(&old_pid);
            }
            abc.recv_mid = None;
            abc.send_mid = None;
        }
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.routes_established = false;
            s.debug_log("server", "ice_restart", &format!("side=abc abc_id={}", abc_id));
        }
        let abc_ws = match self.abcs.get(abc_id) {
            Some(a) => a.ws_tx.clone(),
            None => return,
        };
        let _ = abc_ws.send(SignalingMessage::IceRestart);
    }

    async fn handle_translator_ice_restart(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(old_pid) = session.translator_peer_id.take() {
                let _ = self
                    .sfu_cmd_tx
                    .send(SfuCommand::RemovePeer { peer_id: old_pid });
                self.peer_lookup.remove(&old_pid);
            }
            session.translator_recv_mid = None;
            session.translator_send_mid = None;
            session.routes_established = false;
            session.debug_log("server", "ice_restart", "side=translator");
        }
        if let Some(session) = self.sessions.get(session_id) {
            let _ = session.translator_ws_tx.send(SignalingMessage::IceRestart);
        }
    }

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------

    async fn teardown_session(&mut self, session_id: &str) {
        if let Some(mut session) = self.sessions.remove(session_id) {
            tracing::info!("Tearing down session: {}", session_id);

            if let Some(recorder) = session.recorder.take() {
                recorder.stop();
            }

            if let Some(abc) = self.abcs.get_mut(&session.abc_id) {
                let _ = abc.ws_tx.send(SignalingMessage::SessionStop {
                    session_id: session_id.to_string(),
                });
                // Remove ABC peer from SFU
                if let Some(pid) = abc.peer_id.take() {
                    let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                    self.peer_lookup.remove(&pid);
                }
                abc.active_session_id = None;
                abc.recv_mid = None;
                abc.send_mid = None;
            }

            // Remove translator peer from SFU
            if let Some(pid) = session.translator_peer_id {
                let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                self.peer_lookup.remove(&pid);
            }

            // Remove listener peers from SFU
            for (_, listener) in session.listeners.drain() {
                if let Some(pid) = listener.peer_id {
                    let _ = self.sfu_cmd_tx.send(SfuCommand::RemovePeer { peer_id: pid });
                    self.peer_lookup.remove(&pid);
                }
            }

            if let Err(e) = self.update_session_state(session_id, "completed") {
                tracing::error!("Failed to update session state to completed: {}", e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // DB helpers
    // -----------------------------------------------------------------------

    fn update_session_state(&self, session_id: &str, state: &str) -> anyhow::Result<()> {
        let conn = self.db.conn().map_err(|e| anyhow::anyhow!(e))?;
        if state == "completed" || state == "failed" {
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE sessions SET state = ?1, ended_at = ?2 WHERE id = ?3",
                rusqlite::params![state, now, session_id],
            )?;
        } else {
            conn.execute(
                "UPDATE sessions SET state = ?1 WHERE id = ?2",
                rusqlite::params![state, session_id],
            )?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Health stats (stubbed for now — str0m stats will be added later)
    // -----------------------------------------------------------------------

    async fn collect_health_stats(&mut self) {
        let session_keys: Vec<String> = self.sessions.keys().cloned().collect();

        for session_id in session_keys {
            if let Some(session) = self.sessions.get_mut(&session_id) {
                session.last_health_check = Instant::now();

                // Stub: send empty health stats to translator
                let _ = session.translator_ws_tx.send(SignalingMessage::Health {
                    latency_ms: session.health.latency_ms,
                    packet_loss: session.health.packet_loss,
                    jitter_ms: session.health.jitter_ms,
                    bitrate_kbps: session.health.bitrate_kbps,
                });
            }
        }
    }
}
