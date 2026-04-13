use anyhow::Result;
use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_OPUS};
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;

use crate::config::AudioConfig;

pub struct AbcPeerConnection {
    pc: Arc<RTCPeerConnection>,
    #[allow(dead_code)]
    audio_track: Arc<TrackLocalStaticRTP>,
    #[allow(dead_code)]
    audio_config: AudioConfig,
}

impl AbcPeerConnection {
    pub async fn create_and_set_offer(&self) -> Result<String> {
        let offer = self.pc.create_offer(None).await?;
        self.pc.set_local_description(offer.clone()).await?;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let local_desc = self
            .pc
            .local_description()
            .await
            .ok_or_else(|| anyhow::anyhow!("No local description"))?;
        Ok(local_desc.sdp)
    }

    pub async fn set_remote_answer(&self, sdp: &str) -> Result<()> {
        let answer = RTCSessionDescription::answer(sdp.to_string())?;
        self.pc.set_remote_description(answer).await?;
        tracing::info!("Remote answer set, WebRTC connection establishing");

        self.start_sending_audio().await;

        Ok(())
    }

    pub async fn handle_offer_and_answer(&self, sdp: &str) -> Result<String> {
        let offer = RTCSessionDescription::offer(sdp.to_string())?;
        self.pc.set_remote_description(offer).await?;
        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer.clone()).await?;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let local_desc = self
            .pc
            .local_description()
            .await
            .ok_or_else(|| anyhow::anyhow!("No local description"))?;

        self.start_sending_audio().await;

        Ok(local_desc.sdp)
    }

    pub async fn add_ice_candidate(
        &self,
        candidate: &str,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    ) -> Result<()> {
        if candidate.is_empty() {
            return Ok(());
        }
        let init = RTCIceCandidateInit {
            candidate: candidate.to_string(),
            sdp_mid,
            sdp_mline_index: sdp_m_line_index,
            username_fragment: None,
        };
        self.pc.add_ice_candidate(init).await?;
        Ok(())
    }

    pub async fn close(&self) {
        let _ = self.pc.close().await;
    }

    async fn start_sending_audio(&self) {
        let track = self.audio_track.clone();

        #[cfg(feature = "headless")]
        {
            tokio::spawn(async move {
                if let Err(e) = crate::headless::send_sine_wave_rtp(track).await {
                    tracing::error!(error = %e, "Audio send error");
                }
            });
        }

        #[cfg(not(feature = "headless"))]
        {
            let device = self.audio_config.capture_device.clone();
            let gain = self.audio_config.capture_gain;
            tokio::spawn(async move {
                if let Err(e) = crate::alsa_audio::capture_and_send_rtp(&device, gain, track).await
                {
                    tracing::error!(error = %e, "ALSA capture error");
                }
            });
        }
    }
}

pub async fn create_peer_connection(
    ice_tx: mpsc::UnboundedSender<String>,
    audio_config: AudioConfig,
) -> Result<AbcPeerConnection> {
    let mut m = MediaEngine::default();
    m.register_default_codecs()?;

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut m)?;

    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
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
            mime_type: MIME_TYPE_OPUS.to_owned(),
            clock_rate: 48000,
            channels: 1,
            ..Default::default()
        },
        "audio-source".to_string(),
        "streamlate-abc".to_string(),
    ));

    pc.add_track(Arc::clone(&audio_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await?;

    pc.on_ice_candidate(Box::new(move |candidate| {
        let ice_tx = ice_tx.clone();
        Box::pin(async move {
            if let Some(candidate) = candidate {
                let json = candidate.to_json().unwrap();
                let msg = serde_json::json!({
                    "type": "ice-candidate",
                    "candidate": json.candidate,
                    "sdp_mid": json.sdp_mid,
                    "sdp_m_line_index": json.sdp_mline_index,
                });
                let _ = ice_tx.send(msg.to_string());
            }
        })
    }));

    pc.on_ice_connection_state_change(Box::new(move |state| {
        tracing::info!(ice_state = ?state, "ICE connection state changed");
        Box::pin(async {})
    }));

    pc.on_peer_connection_state_change(Box::new(move |state| {
        tracing::info!(pc_state = ?state, "Peer connection state changed");
        Box::pin(async {})
    }));

    {
        #[cfg(feature = "headless")]
        {
            pc.on_track(Box::new(move |track, _receiver, _transceiver| {
                tracing::info!("Received remote track");
                tokio::spawn(async move {
                    crate::headless::receive_remote_track(track).await;
                });
                Box::pin(async {})
            }));
        }

        #[cfg(not(feature = "headless"))]
        {
            let playback_device = audio_config.playback_device.clone();
            let playback_gain = audio_config.playback_gain;
            pc.on_track(Box::new(move |track, _receiver, _transceiver| {
                tracing::info!("Received remote track");
                let device = playback_device.clone();
                let gain = playback_gain;
                tokio::spawn(async move {
                    if let Err(e) =
                        crate::alsa_audio::receive_and_playback(&device, gain, track).await
                    {
                        tracing::error!(error = %e, "ALSA playback error");
                    }
                });
                Box::pin(async {})
            }));
        }
    }

    Ok(AbcPeerConnection {
        pc,
        audio_track,
        audio_config,
    })
}
