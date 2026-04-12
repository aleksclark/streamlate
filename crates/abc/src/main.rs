use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTPCodecType};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;

use tracing_subscriber::EnvFilter;

mod audio;
mod signaling;

use audio::SineWaveGenerator;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("ABC_LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let headless = std::env::args().any(|a| a == "--headless")
        || cfg!(feature = "headless");

    if headless {
        tracing::info!("Starting streamlate-abc in headless mode");
    } else {
        tracing::info!("Starting streamlate-abc");
    }

    let server_url =
        std::env::var("ABC_SERVER_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
    let abc_id = std::env::var("ABC_ID").unwrap_or_default();
    let abc_secret = std::env::var("ABC_SECRET").unwrap_or_default();
    let listen_port: u16 = std::env::var("ABC_LISTEN_PORT")
        .unwrap_or_else(|_| "9090".to_string())
        .parse()
        .unwrap_or(9090);

    tracing::info!("Server URL: {}", server_url);
    tracing::info!("ABC ID: {}", abc_id);

    if abc_id.is_empty() || abc_secret.is_empty() {
        tracing::warn!("ABC_ID or ABC_SECRET not set, waiting for configuration...");
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    }

    let received_audio = Arc::new(audio::ReceivedAudioBuffer::new());

    if headless {
        let buf = received_audio.clone();
        tokio::spawn(async move {
            audio::run_verification_server(listen_port, buf).await;
        });
    }

    loop {
        match run_abc_client(&server_url, &abc_id, &abc_secret, received_audio.clone()).await {
            Ok(()) => {
                tracing::info!("ABC client exited cleanly");
            }
            Err(e) => {
                tracing::error!("ABC client error: {}", e);
            }
        }
        tracing::info!("Reconnecting in 3 seconds...");
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn run_abc_client(
    server_url: &str,
    abc_id: &str,
    abc_secret: &str,
    received_audio: Arc<audio::ReceivedAudioBuffer>,
) -> Result<()> {
    let ws_url = format!(
        "{}/ws/abc/{}?token={}",
        server_url.replace("http://", "ws://").replace("https://", "wss://"),
        abc_id,
        abc_secret
    );

    tracing::info!("Connecting to WebSocket: {}", ws_url);
    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url).await?;
    tracing::info!("WebSocket connected");

    let (mut ws_sink, mut ws_source) = ws_stream.split();
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<signaling::SignalingMessage>();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = outgoing_rx.recv().await {
            let json = serde_json::to_string(&msg).unwrap_or_default();
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    let out_tx = outgoing_tx.clone();
    let ra = received_audio.clone();
    let recv_task = tokio::spawn(async move {
        let mut pc: Option<Arc<webrtc::peer_connection::RTCPeerConnection>> = None;
        let mut sine_gen: Option<SineWaveGenerator> = None;

        while let Some(msg_result) = ws_source.next().await {
            let msg = match msg_result {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!("WebSocket error: {}", e);
                    break;
                }
            };

            let text = match msg {
                Message::Text(t) => t.to_string(),
                Message::Close(_) => break,
                Message::Ping(_data) => {
                    let _ = out_tx.send(signaling::SignalingMessage::Pong);
                    continue;
                }
                _ => continue,
            };

            let sig_msg: signaling::SignalingMessage = match serde_json::from_str(&text) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("Invalid message: {} - {}", e, text);
                    continue;
                }
            };

            match sig_msg {
                signaling::SignalingMessage::Welcome { .. } => {
                    tracing::info!("Received welcome from server");
                }
                signaling::SignalingMessage::SessionStart { session_id, session_name } => {
                    tracing::info!("Session starting: {} ({})", session_id, session_name);

                    match create_abc_peer_connection(out_tx.clone(), ra.clone()).await {
                        Ok((new_pc, gen)) => {
                            pc = Some(new_pc.clone());
                            sine_gen = Some(gen);

                            match create_and_send_offer(&new_pc, &out_tx).await {
                                Ok(()) => tracing::info!("Sent offer to server"),
                                Err(e) => tracing::error!("Failed to create offer: {}", e),
                            }
                        }
                        Err(e) => {
                            tracing::error!("Failed to create peer connection: {}", e);
                        }
                    }
                }
                signaling::SignalingMessage::SessionStop { session_id } => {
                    tracing::info!("Session stopping: {}", session_id);
                    if let Some(ref p) = pc {
                        let _ = p.close().await;
                    }
                    pc = None;
                    if let Some(ref g) = sine_gen {
                        g.stop();
                    }
                    sine_gen = None;
                }
                signaling::SignalingMessage::Answer { sdp } => {
                    tracing::info!("Received answer from server");
                    if let Some(ref p) = pc {
                        let answer = RTCSessionDescription::answer(sdp).unwrap();
                        if let Err(e) = p.set_remote_description(answer).await {
                            tracing::error!("Failed to set remote description: {}", e);
                        }
                    }
                }
                signaling::SignalingMessage::IceCandidate { candidate, sdp_mid, sdp_m_line_index } => {
                    if let Some(ref p) = pc {
                        let init = RTCIceCandidateInit {
                            candidate,
                            sdp_mid,
                            sdp_mline_index: sdp_m_line_index,
                            ..Default::default()
                        };
                        if let Err(e) = p.add_ice_candidate(init).await {
                            tracing::error!("Failed to add ICE candidate: {}", e);
                        }
                    }
                }
                signaling::SignalingMessage::Ping => {
                    let _ = out_tx.send(signaling::SignalingMessage::Pong);
                }
                _ => {
                    tracing::debug!("Unhandled message: {:?}", sig_msg);
                }
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    Ok(())
}

async fn create_abc_peer_connection(
    sig_tx: mpsc::UnboundedSender<signaling::SignalingMessage>,
    received_audio: Arc<audio::ReceivedAudioBuffer>,
) -> Result<(Arc<webrtc::peer_connection::RTCPeerConnection>, SineWaveGenerator)> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs()?;

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine)?;

    let setting_engine = SettingEngine::default();

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .with_setting_engine(setting_engine)
        .build();

    let config = RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_string()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let pc = Arc::new(api.new_peer_connection(config).await?);

    let audio_track = Arc::new(TrackLocalStaticRTP::new(
        RTCRtpCodecCapability {
            mime_type: "audio/opus".to_string(),
            clock_rate: 48000,
            channels: 1,
            ..Default::default()
        },
        "abc-audio".to_string(),
        "abc-stream".to_string(),
    ));

    pc.add_track(audio_track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await?;

    pc.add_transceiver_from_kind(RTPCodecType::Audio, None)
        .await?;

    let sine_gen = SineWaveGenerator::new(440.0, audio_track);

    let sig_tx_ice = sig_tx.clone();
    pc.on_ice_candidate(Box::new(move |candidate| {
        let sig_tx = sig_tx_ice.clone();
        Box::pin(async move {
            if let Some(c) = candidate {
                let json = c.to_json().unwrap();
                let _ = sig_tx.send(signaling::SignalingMessage::IceCandidate {
                    candidate: json.candidate,
                    sdp_mid: json.sdp_mid,
                    sdp_m_line_index: json.sdp_mline_index,
                });
            }
        })
    }));

    pc.on_track(Box::new(move |track, _receiver, _transceiver| {
        let received_audio = received_audio.clone();
        Box::pin(async move {
            tracing::info!("ABC received track from server: {}", track.codec().capability.mime_type);
            tokio::spawn(async move {
                loop {
                    match track.read_rtp().await {
                        Ok((_pkt, _)) => {
                            received_audio.record_packet();
                        }
                        Err(_) => break,
                    }
                }
            });
        })
    }));

    pc.on_ice_connection_state_change(Box::new(move |state| {
        tracing::info!("ABC ICE state: {:?}", state);
        Box::pin(async {})
    }));

    Ok((pc, sine_gen))
}

async fn create_and_send_offer(
    pc: &Arc<webrtc::peer_connection::RTCPeerConnection>,
    sig_tx: &mpsc::UnboundedSender<signaling::SignalingMessage>,
) -> Result<()> {
    let offer = pc.create_offer(None).await?;
    pc.set_local_description(offer.clone()).await?;
    let _ = sig_tx.send(signaling::SignalingMessage::Offer { sdp: offer.sdp });
    Ok(())
}
