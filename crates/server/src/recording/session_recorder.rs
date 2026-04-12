use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::sync::mpsc;

use crate::recording::metadata::{RecordingEvent, RecordingMetadata, RecordingState};
use crate::recording::ogg_writer::OggOpusWriter;

pub enum RecorderMessage {
    SourcePacket(Vec<u8>),
    TranslationPacket(Vec<u8>),
    Event(RecordingEvent),
    Stop,
}

pub struct SessionRecorderHandle {
    pub tx: mpsc::UnboundedSender<RecorderMessage>,
    pub recording_id: String,
    pub session_id: String,
    pub dir: PathBuf,
}

impl SessionRecorderHandle {
    pub fn send_source_packet(&self, data: Vec<u8>) {
        let _ = self.tx.send(RecorderMessage::SourcePacket(data));
    }

    pub fn send_translation_packet(&self, data: Vec<u8>) {
        let _ = self.tx.send(RecorderMessage::TranslationPacket(data));
    }

    pub fn send_event(&self, event: RecordingEvent) {
        let _ = self.tx.send(RecorderMessage::Event(event));
    }

    pub fn stop(&self) {
        let _ = self.tx.send(RecorderMessage::Stop);
    }
}

pub struct SessionRecorderConfig {
    pub session_id: String,
    pub session_name: String,
    pub translator_id: String,
    pub translator_name: String,
    pub abc_id: String,
    pub abc_name: String,
    pub recording_path: PathBuf,
    pub flush_pages: u32,
    pub db: crate::db::Database,
}

pub fn start_session_recorder(
    config: SessionRecorderConfig,
) -> std::io::Result<SessionRecorderHandle> {
    let recording_id = uuid::Uuid::new_v4().to_string();
    let dir = config.recording_path.join(&config.session_id);
    std::fs::create_dir_all(&dir)?;

    let source_path = dir.join("source.ogg");
    let translation_path = dir.join("translation.ogg");
    let metadata_path = dir.join("metadata.json");

    let started_at = chrono::Utc::now().to_rfc3339();

    let metadata = RecordingMetadata {
        session_id: config.session_id.clone(),
        session_name: config.session_name,
        translator_id: config.translator_id,
        translator_name: config.translator_name,
        abc_id: config.abc_id,
        abc_name: config.abc_name,
        started_at: started_at.clone(),
        ended_at: None,
        duration_seconds: None,
        source_file: "source.ogg".to_string(),
        translation_file: "translation.ogg".to_string(),
        state: RecordingState::Recording,
        events: vec![RecordingEvent {
            time: 0.0,
            event_type: "session_start".to_string(),
            value: None,
        }],
    };

    write_metadata(&metadata_path, &metadata)?;

    {
        let conn = config.db.conn().map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
        })?;
        conn.execute(
            "INSERT INTO recordings (id, session_id, source_path, translation_path, metadata_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                recording_id,
                config.session_id,
                source_path.to_string_lossy().to_string(),
                translation_path.to_string_lossy().to_string(),
                metadata_path.to_string_lossy().to_string(),
                started_at,
            ],
        )
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    }

    let (tx, rx) = mpsc::unbounded_channel();

    let handle = SessionRecorderHandle {
        tx,
        recording_id: recording_id.clone(),
        session_id: config.session_id.clone(),
        dir: dir.clone(),
    };

    let db = config.db;
    let rec_id = recording_id.clone();
    let session_id = config.session_id;

    tokio::spawn(async move {
        if let Err(e) = recorder_task(
            rx,
            source_path,
            translation_path,
            metadata_path,
            metadata,
            config.flush_pages,
            db,
            rec_id,
            session_id,
        )
        .await
        {
            tracing::error!("Recorder task failed: {}", e);
        }
    });

    Ok(handle)
}

async fn recorder_task(
    mut rx: mpsc::UnboundedReceiver<RecorderMessage>,
    source_path: PathBuf,
    translation_path: PathBuf,
    metadata_path: PathBuf,
    mut metadata: RecordingMetadata,
    flush_pages: u32,
    db: crate::db::Database,
    recording_id: String,
    _session_id: String,
) -> std::io::Result<()> {
    let mut source_writer = OggOpusWriter::new(&source_path, flush_pages)?;
    let mut translation_writer = OggOpusWriter::new(&translation_path, flush_pages)?;
    let start_time = Instant::now();

    while let Some(msg) = rx.recv().await {
        match msg {
            RecorderMessage::SourcePacket(data) => {
                if let Err(e) = source_writer.write_opus_packet(&data) {
                    tracing::error!("Failed to write source packet: {}", e);
                }
            }
            RecorderMessage::TranslationPacket(data) => {
                if let Err(e) = translation_writer.write_opus_packet(&data) {
                    tracing::error!("Failed to write translation packet: {}", e);
                }
            }
            RecorderMessage::Event(event) => {
                metadata.events.push(event);
                if let Err(e) = write_metadata(&metadata_path, &metadata) {
                    tracing::error!("Failed to write metadata: {}", e);
                }
            }
            RecorderMessage::Stop => {
                break;
            }
        }
    }

    source_writer.finalize()?;
    translation_writer.finalize()?;

    let duration = source_writer.duration_seconds().max(translation_writer.duration_seconds());
    let ended_at = chrono::Utc::now().to_rfc3339();

    metadata.ended_at = Some(ended_at);
    metadata.duration_seconds = Some(duration);
    metadata.state = RecordingState::Completed;
    metadata.events.push(RecordingEvent {
        time: start_time.elapsed().as_secs_f64(),
        event_type: "session_end".to_string(),
        value: None,
    });

    write_metadata(&metadata_path, &metadata)?;

    let source_size = std::fs::metadata(&source_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let translation_size = std::fs::metadata(&translation_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let total_size = (source_size + translation_size) as i64;

    if let Ok(conn) = db.conn() {
        let _ = conn.execute(
            "UPDATE recordings SET duration_seconds = ?1, size_bytes = ?2 WHERE id = ?3",
            rusqlite::params![duration, total_size, recording_id],
        );
    }

    tracing::info!(
        "Recording finalized: session={}, duration={:.1}s, size={}",
        metadata.session_id,
        duration,
        total_size
    );

    Ok(())
}

fn write_metadata(path: &Path, metadata: &RecordingMetadata) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(metadata)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
