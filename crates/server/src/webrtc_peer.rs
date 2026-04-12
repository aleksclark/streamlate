use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;

use crate::signaling::SignalingMessage;

pub struct PeerConnectionWrapper {
    pub pc: Arc<RTCPeerConnection>,
    #[allow(dead_code)]
    pub signaling_tx: mpsc::UnboundedSender<SignalingMessage>,
}

pub async fn create_peer_connection(
    signaling_tx: mpsc::UnboundedSender<SignalingMessage>,
) -> anyhow::Result<PeerConnectionWrapper> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs()?;

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine)?;

    let mut setting_engine = SettingEngine::default();
    setting_engine.set_lite(true);
    setting_engine.set_ice_multicast_dns_mode(webrtc::ice::mdns::MulticastDnsMode::Disabled);

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

    let sig_tx = signaling_tx.clone();
    pc.on_ice_candidate(Box::new(move |candidate| {
        let sig_tx = sig_tx.clone();
        Box::pin(async move {
            if let Some(c) = candidate {
                let json = match c.to_json() {
                    Ok(j) => j,
                    Err(_) => return,
                };
                let _ = sig_tx.send(SignalingMessage::IceCandidate {
                    candidate: json.candidate,
                    sdp_mid: json.sdp_mid,
                    sdp_m_line_index: json.sdp_mline_index,
                });
            }
        })
    }));

    let sig_tx2 = signaling_tx.clone();
    pc.on_ice_connection_state_change(Box::new(move |state| {
        let sig_tx = sig_tx2.clone();
        Box::pin(async move {
            tracing::debug!("ICE connection state changed: {:?}", state);
            if state == RTCIceConnectionState::Failed {
                let _ = sig_tx.send(SignalingMessage::Error {
                    code: "ice_failed".to_string(),
                    message: "ICE connection failed".to_string(),
                });
            }
        })
    }));

    Ok(PeerConnectionWrapper {
        pc,
        signaling_tx,
    })
}

pub async fn handle_offer(
    pc: &RTCPeerConnection,
    sdp: &str,
) -> anyhow::Result<String> {
    let offer = RTCSessionDescription::offer(sdp.to_string())?;
    pc.set_remote_description(offer).await?;

    let answer = pc.create_answer(None).await?;
    pc.set_local_description(answer.clone()).await?;

    Ok(answer.sdp)
}

pub async fn add_ice_candidate(
    pc: &RTCPeerConnection,
    candidate: &str,
    sdp_mid: Option<String>,
    sdp_m_line_index: Option<u16>,
) -> anyhow::Result<()> {
    let init = RTCIceCandidateInit {
        candidate: candidate.to_string(),
        sdp_mid,
        sdp_mline_index: sdp_m_line_index,
        ..Default::default()
    };
    pc.add_ice_candidate(init).await?;
    Ok(())
}

pub async fn add_send_track(
    pc: &RTCPeerConnection,
    track: Arc<TrackLocalStaticRTP>,
) -> anyhow::Result<()> {
    pc.add_track(track as Arc<dyn TrackLocal + Send + Sync>)
        .await?;
    Ok(())
}
