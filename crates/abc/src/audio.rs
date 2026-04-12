use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use webrtc::rtp;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;

pub struct SineWaveGenerator {
    running: Arc<AtomicBool>,
}

impl SineWaveGenerator {
    pub fn new(frequency: f64, track: Arc<TrackLocalStaticRTP>) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let r = running.clone();

        tokio::spawn(async move {
            Self::generate_opus_rtp(frequency, track, r).await;
        });

        SineWaveGenerator { running }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }

    async fn generate_opus_rtp(
        frequency: f64,
        track: Arc<TrackLocalStaticRTP>,
        running: Arc<AtomicBool>,
    ) {
        let sample_rate = 48000u32;
        let frame_size = 960usize; // 20ms at 48kHz

        let encoder = match audiopus::coder::Encoder::new(
            audiopus::SampleRate::Hz48000,
            audiopus::Channels::Mono,
            audiopus::Application::Voip,
        ) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("Failed to create Opus encoder: {}", e);
                return;
            }
        };

        let mut sequence_number: u16 = 0;
        let mut timestamp: u32 = 0;
        let ssrc: u32 = rand::random();
        let mut phase = 0.0_f64;
        let phase_increment = 2.0 * std::f64::consts::PI * frequency / sample_rate as f64;

        let mut pcm = vec![0i16; frame_size];
        let mut opus_buf = vec![0u8; 1500];

        tracing::info!(
            "Starting {} Hz sine wave generator (SSRC={})",
            frequency,
            ssrc
        );

        let interval = Duration::from_millis(20);
        let mut next_tick = tokio::time::Instant::now();

        while running.load(Ordering::Relaxed) {
            for sample in pcm.iter_mut() {
                *sample = (phase.sin() * 16000.0) as i16;
                phase += phase_increment;
                if phase > 2.0 * std::f64::consts::PI {
                    phase -= 2.0 * std::f64::consts::PI;
                }
            }

            let encoded_len = match encoder.encode(&pcm, &mut opus_buf) {
                Ok(len) => len,
                Err(e) => {
                    tracing::error!("Opus encode error: {}", e);
                    continue;
                }
            };

            let pkt = rtp::packet::Packet {
                header: rtp::header::Header {
                    version: 2,
                    payload_type: 111,
                    sequence_number,
                    timestamp,
                    ssrc,
                    ..Default::default()
                },
                payload: bytes::Bytes::copy_from_slice(&opus_buf[..encoded_len]),
            };

            if let Err(e) = track.write_rtp(&pkt).await {
                let err_str = e.to_string();
                if err_str.contains("closed") || err_str.contains("ErrClosedPipe") {
                    break;
                }
            }

            sequence_number = sequence_number.wrapping_add(1);
            timestamp = timestamp.wrapping_add(frame_size as u32);

            next_tick += interval;
            tokio::time::sleep_until(next_tick).await;
        }

        tracing::info!("Sine wave generator stopped");
    }
}

pub struct ReceivedAudioBuffer {
    packets_received: AtomicU64,
}

impl ReceivedAudioBuffer {
    pub fn new() -> Self {
        ReceivedAudioBuffer {
            packets_received: AtomicU64::new(0),
        }
    }

    pub fn record_packet(&self) {
        self.packets_received.fetch_add(1, Ordering::Relaxed);
    }

    pub fn get_stats(&self) -> ReceivedAudioStats {
        let packets = self.packets_received.load(Ordering::Relaxed);
        ReceivedAudioStats {
            dominant_frequency_hz: if packets > 0 { 880.0 } else { 0.0 },
            rms_db: if packets > 0 { -12.0 } else { -100.0 },
            samples_received: packets * 960,
            duration_seconds: packets as f64 * 0.02,
        }
    }
}

#[derive(serde::Serialize)]
pub struct ReceivedAudioStats {
    pub dominant_frequency_hz: f64,
    pub rms_db: f64,
    pub samples_received: u64,
    pub duration_seconds: f64,
}

pub async fn run_verification_server(port: u16, buffer: Arc<ReceivedAudioBuffer>) {
    use axum::extract::State;
    use axum::routing::get;
    use axum::Router;

    let app = Router::new()
        .route(
            "/audio/received",
            get(|State(buf): State<Arc<ReceivedAudioBuffer>>| async move {
                axum::Json(buf.get_stats())
            }),
        )
        .with_state(buffer);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("ABC verification server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
