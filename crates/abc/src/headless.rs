use anyhow::Result;
use std::sync::Arc;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc::track::track_remote::TrackRemote;

use crate::verification;

const SAMPLE_RATE: u32 = 48000;
const FRAME_SIZE: usize = 960;
const FREQUENCY: f64 = 440.0;

pub async fn send_sine_wave_rtp(track: Arc<TrackLocalStaticRTP>) -> Result<()> {
    tracing::info!("Starting 440 Hz sine wave RTP sender");

    let mut phase: f64 = 0.0;
    let phase_increment = 2.0 * std::f64::consts::PI * FREQUENCY / SAMPLE_RATE as f64;
    let mut timestamp: u32 = 0;
    let mut sequence: u16 = 0;

    let mut encoder = opus::Encoder::new(
        SAMPLE_RATE,
        opus::Channels::Mono,
        opus::Application::Voip,
    )?;

    loop {
        let mut pcm = vec![0i16; FRAME_SIZE];
        for sample in pcm.iter_mut() {
            *sample = (phase.sin() * 16000.0) as i16;
            phase += phase_increment;
            if phase > 2.0 * std::f64::consts::PI {
                phase -= 2.0 * std::f64::consts::PI;
            }
        }

        let mut opus_buf = vec![0u8; 4000];
        let encoded_len = encoder.encode(&pcm, &mut opus_buf)?;
        let opus_data = &opus_buf[..encoded_len];

        let rtp_packet = webrtc::rtp::packet::Packet {
            header: webrtc::rtp::header::Header {
                version: 2,
                padding: false,
                extension: false,
                marker: false,
                payload_type: 111,
                sequence_number: sequence,
                timestamp,
                ssrc: 1,
                ..Default::default()
            },
            payload: bytes::Bytes::copy_from_slice(opus_data),
        };

        match track.write_rtp(&rtp_packet).await {
            Ok(_) => {}
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("ErrClosedPipe") || msg.contains("closed") {
                    tracing::info!("Track closed, stopping audio sender");
                    return Ok(());
                }
                tracing::warn!(error = %e, "RTP write error");
            }
        }

        sequence = sequence.wrapping_add(1);
        timestamp = timestamp.wrapping_add(FRAME_SIZE as u32);

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

pub async fn receive_remote_track(track: Arc<TrackRemote>) {
    tracing::info!(
        codec = %track.codec().capability.mime_type,
        "Processing remote track"
    );

    let vs = verification::GLOBAL_VERIFICATION.clone();

    let mut decoder = match opus::Decoder::new(SAMPLE_RATE, opus::Channels::Mono) {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create Opus decoder");
            return;
        }
    };

    let mut pcm_buf = vec![0i16; FRAME_SIZE * 2];

    loop {
        let (rtp_packet, _) = match track.read_rtp().await {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!(error = %e, "Track read ended");
                break;
            }
        };

        let decoded_samples = match decoder.decode(
            &rtp_packet.payload,
            &mut pcm_buf,
            false,
        ) {
            Ok(n) => n,
            Err(e) => {
                tracing::debug!(error = %e, "Opus decode error");
                continue;
            }
        };

        let samples = &pcm_buf[..decoded_samples];
        vs.add_samples(samples);
    }
}
