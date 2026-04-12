use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

const SAMPLE_RATE: f64 = 48000.0;
const RING_BUFFER_SIZE: usize = 48000;

pub static GLOBAL_VERIFICATION: LazyLock<VerificationState> =
    LazyLock::new(VerificationState::new);

#[derive(Clone)]
pub struct VerificationState {
    inner: Arc<Mutex<VerificationInner>>,
}

struct VerificationInner {
    ring_buffer: Vec<f64>,
    write_pos: usize,
    total_samples: u64,
    start_time: Instant,
    state: String,
    session_name: String,
}

impl VerificationState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VerificationInner {
                ring_buffer: vec![0.0; RING_BUFFER_SIZE],
                write_pos: 0,
                total_samples: 0,
                start_time: Instant::now(),
                state: "booting".to_string(),
                session_name: String::new(),
            })),
        }
    }

    pub fn add_samples(&self, samples: &[i16]) {
        let mut inner = self.inner.lock().unwrap();
        for &sample in samples {
            let normalized = sample as f64 / 32768.0;
            let pos = inner.write_pos;
            inner.ring_buffer[pos] = normalized;
            inner.write_pos = (pos + 1) % RING_BUFFER_SIZE;
            inner.total_samples += 1;
        }
    }

    pub fn set_state(&self, state: &str, session_name: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.state = state.to_string();
        inner.session_name = session_name.to_string();
    }

    fn get_audio_info(&self) -> AudioReceivedResponse {
        let inner = self.inner.lock().unwrap();
        let elapsed = inner.start_time.elapsed().as_secs_f64();

        if inner.total_samples < 1024 {
            return AudioReceivedResponse {
                dominant_frequency_hz: 0.0,
                rms_db: -96.0,
                samples_received: inner.total_samples,
                duration_seconds: elapsed,
            };
        }

        let n = RING_BUFFER_SIZE.min(inner.total_samples as usize);
        let start = if inner.total_samples as usize >= RING_BUFFER_SIZE {
            inner.write_pos
        } else {
            0
        };
        let samples: Vec<f64> = (0..n)
            .map(|i| inner.ring_buffer[(start + i) % RING_BUFFER_SIZE])
            .collect();

        let rms = (samples.iter().map(|s| s * s).sum::<f64>() / samples.len() as f64).sqrt();
        let rms_db = if rms > 0.0 {
            20.0 * rms.log10()
        } else {
            -96.0
        };

        let freq = detect_frequency(&samples, SAMPLE_RATE);

        AudioReceivedResponse {
            dominant_frequency_hz: freq,
            rms_db,
            samples_received: inner.total_samples,
            duration_seconds: elapsed,
        }
    }

    fn get_state_info(&self) -> StateResponse {
        let inner = self.inner.lock().unwrap();
        StateResponse {
            state: inner.state.clone(),
            session_name: inner.session_name.clone(),
            uptime_seconds: inner.start_time.elapsed().as_secs_f64(),
        }
    }
}

fn detect_frequency(samples: &[f64], sample_rate: f64) -> f64 {
    let n = samples.len().min(8192);
    if n < 64 {
        return 0.0;
    }

    let windowed: Vec<f64> = samples[..n]
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let w =
                0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos());
            s * w
        })
        .collect();

    let mut max_magnitude = 0.0f64;
    let mut max_bin = 0usize;

    let freq_resolution = sample_rate / n as f64;
    let min_bin = (50.0 / freq_resolution).ceil() as usize;
    let max_bin_limit = (2000.0 / freq_resolution).floor() as usize;
    let max_bin_limit = max_bin_limit.min(n / 2);

    for bin in min_bin..max_bin_limit {
        let mut real = 0.0f64;
        let mut imag = 0.0f64;
        for (i, &s) in windowed.iter().enumerate() {
            let angle = 2.0 * std::f64::consts::PI * bin as f64 * i as f64 / n as f64;
            real += s * angle.cos();
            imag -= s * angle.sin();
        }
        let magnitude = (real * real + imag * imag).sqrt();
        if magnitude > max_magnitude {
            max_magnitude = magnitude;
            max_bin = bin;
        }
    }

    max_bin as f64 * freq_resolution
}

#[derive(Serialize)]
pub struct AudioReceivedResponse {
    pub dominant_frequency_hz: f64,
    pub rms_db: f64,
    pub samples_received: u64,
    pub duration_seconds: f64,
}

#[derive(Serialize)]
pub struct StateResponse {
    pub state: String,
    pub session_name: String,
    pub uptime_seconds: f64,
}

async fn audio_received_handler() -> Json<AudioReceivedResponse> {
    Json(GLOBAL_VERIFICATION.get_audio_info())
}

async fn state_handler() -> Json<StateResponse> {
    Json(GLOBAL_VERIFICATION.get_state_info())
}

async fn health_handler() -> &'static str {
    "ok"
}

pub async fn run_verification_server(_vs: VerificationState) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/audio/received", get(audio_received_handler))
        .route("/state", get(state_handler))
        .route("/health", get(health_handler));

    let bind = "0.0.0.0:9090";
    tracing::info!("Verification server listening on {}", bind);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_440hz_sine() {
        let sample_rate = 48000.0;
        let freq = 440.0;
        let n = 8192;
        let samples: Vec<f64> = (0..n)
            .map(|i| {
                (2.0 * std::f64::consts::PI * freq * i as f64 / sample_rate).sin() * 0.5
            })
            .collect();

        let detected = detect_frequency(&samples, sample_rate);
        let tolerance = sample_rate / n as f64;
        assert!(
            (detected - freq).abs() < tolerance * 2.0,
            "Expected ~{freq} Hz, got {detected} Hz"
        );
    }

    #[test]
    fn detect_880hz_sine() {
        let sample_rate = 48000.0;
        let freq = 880.0;
        let n = 8192;
        let samples: Vec<f64> = (0..n)
            .map(|i| {
                (2.0 * std::f64::consts::PI * freq * i as f64 / sample_rate).sin() * 0.5
            })
            .collect();

        let detected = detect_frequency(&samples, sample_rate);
        let tolerance = sample_rate / n as f64;
        assert!(
            (detected - freq).abs() < tolerance * 2.0,
            "Expected ~{freq} Hz, got {detected} Hz"
        );
    }

    #[test]
    fn verification_state_add_samples() {
        let vs = VerificationState::new();
        let samples: Vec<i16> = (0..960).map(|i| (i % 100) as i16).collect();
        vs.add_samples(&samples);
        let info = vs.get_audio_info();
        assert_eq!(info.samples_received, 960);
    }

    #[test]
    fn verification_state_insufficient_samples() {
        let vs = VerificationState::new();
        let samples: Vec<i16> = vec![1000; 100];
        vs.add_samples(&samples);
        let info = vs.get_audio_info();
        assert_eq!(info.dominant_frequency_hz, 0.0);
        assert_eq!(info.rms_db, -96.0);
    }

    #[test]
    fn verification_state_set_state() {
        let vs = VerificationState::new();
        vs.set_state("session_active", "Main Hall - Spanish");
        let info = vs.get_state_info();
        assert_eq!(info.state, "session_active");
        assert_eq!(info.session_name, "Main Hall - Spanish");
    }

    #[test]
    fn detect_silence() {
        let samples = vec![0.0; 8192];
        let detected = detect_frequency(&samples, 48000.0);
        assert!(
            detected.abs() < 50.0,
            "Silence should detect near-zero frequency, got {detected}"
        );
    }

    #[test]
    fn detect_too_few_samples() {
        let samples = vec![0.5; 32];
        let detected = detect_frequency(&samples, 48000.0);
        assert_eq!(detected, 0.0);
    }
}
