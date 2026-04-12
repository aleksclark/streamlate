use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, RwLock};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc::track::track_remote::TrackRemote;

use crate::config::RecordingConfig;
use crate::recording::metadata::RecordingEvent;
use crate::recording::session_recorder::{SessionRecorderHandle, SessionRecorderConfig, start_session_recorder};
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
}

#[derive(Debug, Clone, Default)]
pub struct HealthStats {
    pub latency_ms: f64,
    pub packet_loss: f64,
    pub jitter_ms: f64,
    pub bitrate_kbps: f64,
}

struct AbcConnection {
    ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    pc: Option<Arc<webrtc::peer_connection::RTCPeerConnection>>,
    #[allow(dead_code)]
    source_track: Arc<RwLock<Option<Arc<TrackRemote>>>>,
    active_session_id: Option<String>,
}

struct ListenerConnection {
    _ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    pc: Option<Arc<webrtc::peer_connection::RTCPeerConnection>>,
    output_track: Option<Arc<TrackLocalStaticRTP>>,
}

struct ActiveSession {
    session_id: String,
    _session_name: String,
    abc_id: String,
    translator_ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    translator_pc: Option<Arc<webrtc::peer_connection::RTCPeerConnection>>,
    abc_source_local: Arc<TrackLocalStaticRTP>,
    translator_source_local: Arc<TrackLocalStaticRTP>,
    listeners: HashMap<String, ListenerConnection>,
    #[allow(dead_code)]
    muted: bool,
    #[allow(dead_code)]
    passthrough: bool,
    health: HealthStats,
    started_at: Instant,
    recorder: Option<SessionRecorderHandle>,
}

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
    pub fn new(db: crate::db::Database, recording_config: RecordingConfig) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let mgr = SessionManagerActor {
            abcs: HashMap::new(),
            sessions: HashMap::new(),
            db,
            recording_config,
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

struct SessionManagerActor {
    abcs: HashMap<String, AbcConnection>,
    sessions: HashMap<String, ActiveSession>,
    db: crate::db::Database,
    recording_config: RecordingConfig,
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
                        pc: None,
                        source_track: Arc::new(RwLock::new(None)),
                        active_session_id: None,
                    },
                );
            }
            SessionCommand::AbcDisconnected { abc_id } => {
                tracing::info!("ABC disconnected: {}", abc_id);
                if let Some(abc) = self.abcs.remove(&abc_id) {
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
                sdp_mid,
                sdp_m_line_index,
            } => {
                self.handle_abc_ice(&abc_id, &candidate, sdp_mid, sdp_m_line_index)
                    .await;
            }
            SessionCommand::TranslatorOffer { session_id, sdp } => {
                self.handle_translator_offer(&session_id, &sdp).await;
            }
            SessionCommand::TranslatorIceCandidate {
                session_id,
                candidate,
                sdp_mid,
                sdp_m_line_index,
            } => {
                self.handle_translator_ice(&session_id, &candidate, sdp_mid, sdp_m_line_index)
                    .await;
            }
            SessionCommand::TranslatorDisconnected { session_id } => {
                tracing::info!("Translator disconnected from session: {}", session_id);
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
                sdp_mid,
                sdp_m_line_index,
            } => {
                self.handle_listener_ice(
                    &session_id,
                    &listener_id,
                    &candidate,
                    sdp_mid,
                    sdp_m_line_index,
                )
                .await;
            }
            SessionCommand::RemoveListener {
                session_id,
                listener_id,
            } => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    if let Some(listener) = session.listeners.remove(&listener_id) {
                        if let Some(pc) = listener.pc {
                            let _ = pc.close().await;
                        }
                    }
                }
            }
            SessionCommand::HandleMute { session_id, muted } => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    session.muted = muted;
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
                        let event_type = if enabled { "passthrough_on" } else { "passthrough_off" };
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
        }
    }

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

        let abc_source_local = Arc::new(TrackLocalStaticRTP::new(
            webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: 48000,
                channels: 1,
                ..Default::default()
            },
            format!("abc-source-{}", session_id),
            format!("abc-stream-{}", session_id),
        ));

        let translator_source_local = Arc::new(TrackLocalStaticRTP::new(
            webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: 48000,
                channels: 1,
                ..Default::default()
            },
            format!("translator-source-{}", session_id),
            format!("translator-stream-{}", session_id),
        ));

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
                tracing::error!("Failed to start recording for session {}: {}", session_id, e);
                None
            }
        };

        let session = ActiveSession {
            session_id: session_id.clone(),
            _session_name: session_name,
            abc_id,
            translator_ws_tx,
            translator_pc: None,
            abc_source_local,
            translator_source_local,
            listeners: HashMap::new(),
            muted: false,
            passthrough: false,
            health: HealthStats::default(),
            started_at: Instant::now(),
            recorder,
        };

        self.sessions.insert(session_id.clone(), session);

        if let Err(e) = self.update_session_state(&session_id, "active") {
            tracing::error!("Failed to update session state: {}", e);
        }

        Ok(())
    }

    async fn handle_abc_offer(&mut self, abc_id: &str, sdp: &str) {
        let session_id = match self.abcs.get(abc_id) {
            Some(a) => match &a.active_session_id {
                Some(s) => s.clone(),
                None => return,
            },
            None => return,
        };

        let abc_source_local = match self.sessions.get(&session_id) {
            Some(s) => s.abc_source_local.clone(),
            None => return,
        };

        let translator_source_local = match self.sessions.get(&session_id) {
            Some(s) => s.translator_source_local.clone(),
            None => return,
        };

        let (sig_tx, mut sig_rx) = mpsc::unbounded_channel();
        let pc_wrapper = match crate::webrtc_peer::create_peer_connection(sig_tx).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("Failed to create ABC peer connection: {}", e);
                return;
            }
        };

        let pc = pc_wrapper.pc.clone();

        if let Err(e) = crate::webrtc_peer::add_send_track(&pc, translator_source_local).await {
            tracing::error!("Failed to add send track to ABC PC: {}", e);
            return;
        }

        let source_track_ref = match self.abcs.get(abc_id) {
            Some(a) => a.source_track.clone(),
            None => return,
        };

        let source_recording_tx = self.sessions.get(&session_id).and_then(|s| {
            s.recorder.as_ref().map(|r| {
                let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
                let recorder_tx = r.tx.clone();
                tokio::spawn(async move {
                    while let Some(data) = rx.recv().await {
                        let _ = recorder_tx.send(
                            crate::recording::session_recorder::RecorderMessage::SourcePacket(data),
                        );
                    }
                });
                tx
            })
        });

        let sid = session_id.clone();
        let asl = abc_source_local.clone();

        pc.on_track(Box::new(move |track, _receiver, _transceiver| {
            let abc_source_local = asl.clone();
            let source_track_ref = source_track_ref.clone();
            let sid = sid.clone();
            let rec_tx = source_recording_tx.clone();

            Box::pin(async move {
                tracing::info!(
                    "ABC track received for session {}: {}",
                    sid,
                    track.codec().capability.mime_type
                );
                {
                    let mut st = source_track_ref.write().await;
                    *st = Some(track.clone());
                }
                Self::forward_rtp(track, abc_source_local, rec_tx).await;
            })
        }));

        let answer_sdp = match crate::webrtc_peer::handle_offer(&pc, sdp).await {
            Ok(a) => a,
            Err(e) => {
                tracing::error!("Failed to handle ABC offer: {}", e);
                return;
            }
        };

        let abc = match self.abcs.get(abc_id) {
            Some(a) => a,
            None => return,
        };

        let ws_tx = abc.ws_tx.clone();
        let _ = ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });

        let abc_ws_tx = abc.ws_tx.clone();
        tokio::spawn(async move {
            while let Some(msg) = sig_rx.recv().await {
                let _ = abc_ws_tx.send(msg);
            }
        });

        if let Some(abc) = self.abcs.get_mut(abc_id) {
            abc.pc = Some(pc);
        }
    }

    async fn handle_abc_ice(
        &self,
        abc_id: &str,
        candidate: &str,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    ) {
        if let Some(abc) = self.abcs.get(abc_id) {
            if let Some(pc) = &abc.pc {
                if let Err(e) =
                    crate::webrtc_peer::add_ice_candidate(pc, candidate, sdp_mid, sdp_m_line_index)
                        .await
                {
                    tracing::error!("Failed to add ABC ICE candidate: {}", e);
                }
            }
        }
    }

    async fn handle_translator_offer(&mut self, session_id: &str, sdp: &str) {
        let (abc_source_local, translator_source_local, translator_ws_tx) =
            match self.sessions.get(session_id) {
                Some(s) => (
                    s.abc_source_local.clone(),
                    s.translator_source_local.clone(),
                    s.translator_ws_tx.clone(),
                ),
                None => return,
            };

        let (sig_tx, mut sig_rx) = mpsc::unbounded_channel();
        let pc_wrapper = match crate::webrtc_peer::create_peer_connection(sig_tx).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("Failed to create translator peer connection: {}", e);
                return;
            }
        };

        let pc = pc_wrapper.pc.clone();

        if let Err(e) = crate::webrtc_peer::add_send_track(&pc, abc_source_local).await {
            tracing::error!("Failed to add ABC source track to translator PC: {}", e);
            return;
        }

        let translation_recording_tx = self.sessions.get(session_id).and_then(|s| {
            s.recorder.as_ref().map(|r| {
                let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
                let recorder_tx = r.tx.clone();
                tokio::spawn(async move {
                    while let Some(data) = rx.recv().await {
                        let _ = recorder_tx.send(
                            crate::recording::session_recorder::RecorderMessage::TranslationPacket(data),
                        );
                    }
                });
                tx
            })
        });

        let sid = session_id.to_string();

        pc.on_track(Box::new(move |track, _receiver, _transceiver| {
            let translator_source_local = translator_source_local.clone();
            let sid = sid.clone();
            let rec_tx = translation_recording_tx.clone();

            Box::pin(async move {
                tracing::info!(
                    "Translator track received for session {}: {}",
                    sid,
                    track.codec().capability.mime_type
                );
                Self::forward_rtp(track, translator_source_local, rec_tx).await;
            })
        }));

        let answer_sdp = match crate::webrtc_peer::handle_offer(&pc, sdp).await {
            Ok(a) => a,
            Err(e) => {
                tracing::error!("Failed to handle translator offer: {}", e);
                return;
            }
        };

        let _ = translator_ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });

        let ws_tx = translator_ws_tx.clone();
        tokio::spawn(async move {
            while let Some(msg) = sig_rx.recv().await {
                let _ = ws_tx.send(msg);
            }
        });

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.translator_pc = Some(pc);
        }
    }

    async fn handle_translator_ice(
        &self,
        session_id: &str,
        candidate: &str,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    ) {
        if let Some(session) = self.sessions.get(session_id) {
            if let Some(pc) = &session.translator_pc {
                if let Err(e) =
                    crate::webrtc_peer::add_ice_candidate(pc, candidate, sdp_mid, sdp_m_line_index)
                        .await
                {
                    tracing::error!("Failed to add translator ICE candidate: {}", e);
                }
            }
        }
    }

    async fn add_listener(
        &mut self,
        session_id: &str,
        listener_id: &str,
        ws_tx: mpsc::UnboundedSender<SignalingMessage>,
    ) {
        if self.sessions.get(session_id).is_none() {
            return;
        }

        let output_track = Arc::new(TrackLocalStaticRTP::new(
            webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: 48000,
                channels: 1,
                ..Default::default()
            },
            format!("listener-{}-{}", listener_id, session_id),
            format!("listener-stream-{}-{}", listener_id, session_id),
        ));

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.listeners.insert(
                listener_id.to_string(),
                ListenerConnection {
                    _ws_tx: ws_tx,
                    pc: None,
                    output_track: Some(output_track),
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
        let (ws_tx, output_track) = {
            let session = match self.sessions.get(session_id) {
                Some(s) => s,
                None => return,
            };

            let listener = match session.listeners.get(listener_id) {
                Some(l) => l,
                None => return,
            };

            let output_track = match &listener.output_track {
                Some(t) => t.clone(),
                None => return,
            };

            (listener._ws_tx.clone(), output_track)
        };

        let (sig_tx, mut sig_rx) = mpsc::unbounded_channel();
        let pc_wrapper = match crate::webrtc_peer::create_peer_connection(sig_tx).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("Failed to create listener peer connection: {}", e);
                return;
            }
        };

        let pc = pc_wrapper.pc.clone();

        if let Err(e) = crate::webrtc_peer::add_send_track(&pc, output_track).await {
            tracing::error!("Failed to add output track to listener PC: {}", e);
            return;
        }

        let answer_sdp = match crate::webrtc_peer::handle_offer(&pc, sdp).await {
            Ok(a) => a,
            Err(e) => {
                tracing::error!("Failed to handle listener offer: {}", e);
                return;
            }
        };

        let _ = ws_tx.send(SignalingMessage::Answer { sdp: answer_sdp });

        let ws_tx2 = ws_tx.clone();
        tokio::spawn(async move {
            while let Some(msg) = sig_rx.recv().await {
                let _ = ws_tx2.send(msg);
            }
        });

        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(listener) = session.listeners.get_mut(listener_id) {
                listener.pc = Some(pc);
            }
        }
    }

    async fn handle_listener_ice(
        &self,
        session_id: &str,
        listener_id: &str,
        candidate: &str,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    ) {
        if let Some(session) = self.sessions.get(session_id) {
            if let Some(listener) = session.listeners.get(listener_id) {
                if let Some(pc) = &listener.pc {
                    if let Err(e) = crate::webrtc_peer::add_ice_candidate(
                        pc,
                        candidate,
                        sdp_mid,
                        sdp_m_line_index,
                    )
                    .await
                    {
                        tracing::error!("Failed to add listener ICE candidate: {}", e);
                    }
                }
            }
        }
    }

    async fn forward_rtp(
        track: Arc<TrackRemote>,
        local_track: Arc<TrackLocalStaticRTP>,
        recording_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    ) {
        loop {
            match track.read_rtp().await {
                Ok((pkt, _attrs)) => {
                    if let Some(ref tx) = recording_tx {
                        let _ = tx.send(pkt.payload.to_vec());
                    }
                    if let Err(e) = local_track.write_rtp(&pkt).await {
                        let err_str = e.to_string();
                        if err_str.contains("closed") || err_str.contains("ErrClosedPipe") {
                            break;
                        }
                        tracing::trace!("RTP write error: {}", e);
                    }
                }
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("closed") || err_str.contains("EOF") || err_str.contains("ErrClosedPipe") {
                        break;
                    }
                    tracing::trace!("RTP read error: {}", e);
                    break;
                }
            }
        }
    }

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
                if let Some(pc) = abc.pc.take() {
                    let _ = pc.close().await;
                }
                abc.active_session_id = None;
            }

            if let Some(pc) = session.translator_pc.take() {
                let _ = pc.close().await;
            }

            for (_, mut listener) in session.listeners.drain() {
                if let Some(pc) = listener.pc.take() {
                    let _ = pc.close().await;
                }
            }

            if let Err(e) = self.update_session_state(session_id, "completed") {
                tracing::error!("Failed to update session state to completed: {}", e);
            }
        }
    }

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

    async fn collect_health_stats(&mut self) {
        for (_, session) in self.sessions.iter_mut() {
            if let Some(pc) = &session.translator_pc {
                let stats = pc.get_stats().await;
                let mut latency = 0.0_f64;
                let mut loss = 0.0_f64;
                let mut bitrate = 0.0_f64;
                let mut found_any = false;

                for (_key, stat) in stats.reports.iter() {
                    use webrtc::stats::StatsReportType;
                    match stat {
                        StatsReportType::InboundRTP(inbound) => {
                            loss = inbound.packets_received as f64;
                            found_any = true;
                            let _ = &inbound;
                        }
                        StatsReportType::RemoteInboundRTP(remote) => {
                            latency = remote.round_trip_time.unwrap_or(0.0);
                            found_any = true;
                        }
                        StatsReportType::OutboundRTP(outbound) => {
                            bitrate = outbound.bytes_sent as f64 * 8.0 / 1000.0;
                            found_any = true;
                        }
                        _ => {}
                    }
                }

                if found_any {
                    session.health = HealthStats {
                        latency_ms: latency * 1000.0,
                        packet_loss: loss,
                        jitter_ms: 0.0,
                        bitrate_kbps: bitrate,
                    };
                }
            }
        }
    }
}
