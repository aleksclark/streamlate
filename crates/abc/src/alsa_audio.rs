use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, StreamConfig};
use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::rtp::packet::Packet;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc::track::track_remote::TrackRemote;

const SAMPLE_RATE: u32 = 48000;
const CHANNELS: u16 = 1;
const FRAME_SIZE: usize = 960; // 20ms at 48kHz

fn find_device(host: &cpal::Host, name: &str, capture: bool) -> Result<cpal::Device> {
    if name == "default" {
        if capture {
            return host
                .default_input_device()
                .ok_or_else(|| anyhow::anyhow!("No default input device"));
        } else {
            return host
                .default_output_device()
                .ok_or_else(|| anyhow::anyhow!("No default output device"));
        }
    }

    let devices = if capture {
        host.input_devices()?
    } else {
        host.output_devices()?
    };

    for device in devices {
        if let Ok(dev_name) = device.name() {
            if dev_name == name {
                return Ok(device);
            }
        }
    }

    anyhow::bail!(
        "Audio device '{}' not found ({})",
        name,
        if capture { "capture" } else { "playback" }
    )
}

fn build_stream_config() -> StreamConfig {
    StreamConfig {
        channels: CHANNELS,
        sample_rate: SampleRate(SAMPLE_RATE),
        buffer_size: cpal::BufferSize::Fixed(FRAME_SIZE as u32),
    }
}

pub async fn capture_and_send_rtp(
    device: &str,
    gain: f32,
    track: Arc<TrackLocalStaticRTP>,
) -> Result<()> {
    tracing::info!(device = %device, gain = %gain, "Starting ALSA capture");

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<i16>>();

    let device_name = device.to_string();
    std::thread::spawn(move || {
        if let Err(e) = run_capture_stream(&device_name, gain, tx) {
            tracing::error!(error = %e, "Capture stream error");
        }
    });

    let mut encoder = opus::Encoder::new(SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip)
        .context("Failed to create Opus encoder")?;

    let mut timestamp: u32 = 0;
    let mut sequence: u16 = 0;
    let mut opus_buf = vec![0u8; 4000];

    while let Some(pcm) = rx.recv().await {
        let encoded_len = match encoder.encode(&pcm, &mut opus_buf) {
            Ok(n) => n,
            Err(e) => {
                tracing::debug!(error = %e, "Opus encode error");
                continue;
            }
        };

        let rtp_packet = Packet {
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
            payload: bytes::Bytes::copy_from_slice(&opus_buf[..encoded_len]),
        };

        match track.write_rtp(&rtp_packet).await {
            Ok(_) => {}
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("ErrClosedPipe") || msg.contains("closed") {
                    tracing::info!("Track closed, stopping ALSA capture");
                    return Ok(());
                }
                tracing::warn!(error = %e, "RTP write error");
            }
        }

        sequence = sequence.wrapping_add(1);
        timestamp = timestamp.wrapping_add(FRAME_SIZE as u32);
    }

    Ok(())
}

fn run_capture_stream(
    device_name: &str,
    gain: f32,
    tx: mpsc::UnboundedSender<Vec<i16>>,
) -> Result<()> {
    let host = cpal::default_host();
    let device = find_device(&host, device_name, true)?;
    let config = build_stream_config();

    tracing::info!(
        device = %device.name().unwrap_or_default(),
        "Opening ALSA capture device"
    );

    let mut accumulator: Vec<i16> = Vec::with_capacity(FRAME_SIZE * 2);

    let stream = device.build_input_stream(
        &config,
        move |data: &[i16], _info: &cpal::InputCallbackInfo| {
            let gained: Vec<i16> = data
                .iter()
                .map(|&s| {
                    let amplified = s as f32 * gain;
                    amplified.clamp(i16::MIN as f32, i16::MAX as f32) as i16
                })
                .collect();

            accumulator.extend_from_slice(&gained);

            while accumulator.len() >= FRAME_SIZE {
                let frame: Vec<i16> = accumulator.drain(..FRAME_SIZE).collect();
                if tx.send(frame).is_err() {
                    return;
                }
            }
        },
        |err| {
            tracing::error!(error = %err, "ALSA capture stream error");
        },
        None,
    )?;

    stream.play()?;

    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

pub async fn receive_and_playback(
    device: &str,
    gain: f32,
    track: Arc<TrackRemote>,
) -> Result<()> {
    tracing::info!(
        device = %device,
        gain = %gain,
        codec = %track.codec().capability.mime_type,
        "Starting ALSA playback"
    );

    let (tx, rx) = mpsc::unbounded_channel::<Vec<i16>>();

    let device_name = device.to_string();
    std::thread::spawn(move || {
        if let Err(e) = run_playback_stream(&device_name, rx) {
            tracing::error!(error = %e, "Playback stream error");
        }
    });

    let mut decoder = opus::Decoder::new(SAMPLE_RATE, opus::Channels::Mono)
        .context("Failed to create Opus decoder")?;
    let mut pcm_buf = vec![0i16; FRAME_SIZE * 2];

    loop {
        let (rtp_packet, _) = match track.read_rtp().await {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!(error = %e, "Track read ended");
                break;
            }
        };

        let decoded_samples = match decoder.decode(&rtp_packet.payload, &mut pcm_buf, false) {
            Ok(n) => n,
            Err(e) => {
                tracing::debug!(error = %e, "Opus decode error");
                continue;
            }
        };

        let samples: Vec<i16> = pcm_buf[..decoded_samples]
            .iter()
            .map(|&s| {
                let amplified = s as f32 * gain;
                amplified.clamp(i16::MIN as f32, i16::MAX as f32) as i16
            })
            .collect();

        if tx.send(samples).is_err() {
            tracing::info!("Playback channel closed");
            break;
        }
    }

    Ok(())
}

fn run_playback_stream(
    device_name: &str,
    mut rx: mpsc::UnboundedReceiver<Vec<i16>>,
) -> Result<()> {
    let host = cpal::default_host();
    let device = find_device(&host, device_name, false)?;
    let config = build_stream_config();

    tracing::info!(
        device = %device.name().unwrap_or_default(),
        "Opening ALSA playback device"
    );

    let buffer = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<i16>::with_capacity(
        FRAME_SIZE * 10,
    )));

    let buf_writer = buffer.clone();
    std::thread::spawn(move || {
        while let Some(samples) = rx.blocking_recv() {
            if let Ok(mut buf) = buf_writer.lock() {
                buf.extend(samples);
                while buf.len() > FRAME_SIZE * 20 {
                    buf.pop_front();
                }
            }
        }
    });

    let buf_reader = buffer;
    let stream = device.build_output_stream(
        &config,
        move |data: &mut [i16], _info: &cpal::OutputCallbackInfo| {
            if let Ok(mut buf) = buf_reader.lock() {
                for sample in data.iter_mut() {
                    *sample = buf.pop_front().unwrap_or(0);
                }
            } else {
                for sample in data.iter_mut() {
                    *sample = 0;
                }
            }
        },
        |err| {
            tracing::error!(error = %err, "ALSA playback stream error");
        },
        None,
    )?;

    stream.play()?;

    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
