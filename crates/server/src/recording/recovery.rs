use std::path::Path;

use crate::db::Database;
use crate::recording::metadata::{RecordingEvent, RecordingMetadata, RecordingState};
use crate::recording::ogg_writer::read_last_granule_position;

const OPUS_SAMPLE_RATE: f64 = 48000.0;

pub fn recover_incomplete_recordings(
    recording_path: &Path,
    db: &Database,
) -> anyhow::Result<u32> {
    if !recording_path.exists() {
        return Ok(0);
    }

    let mut recovered = 0u32;

    let entries = std::fs::read_dir(recording_path)?;
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let dir = entry.path();
        let metadata_path = dir.join("metadata.json");

        if !metadata_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&metadata_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Cannot read metadata at {:?}: {}", metadata_path, e);
                continue;
            }
        };

        let mut metadata: RecordingMetadata = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("Cannot parse metadata at {:?}: {}", metadata_path, e);
                continue;
            }
        };

        if metadata.state != RecordingState::Recording {
            continue;
        }

        tracing::warn!(
            "Found incomplete recording for session {}, recovering...",
            metadata.session_id
        );

        let source_path = dir.join(&metadata.source_file);
        let translation_path = dir.join(&metadata.translation_file);

        let source_duration = read_duration_from_ogg(&source_path);
        let translation_duration = read_duration_from_ogg(&translation_path);
        let duration = source_duration.max(translation_duration);

        metadata.state = RecordingState::Failed;
        metadata.ended_at = Some(chrono::Utc::now().to_rfc3339());
        metadata.duration_seconds = Some(duration);
        metadata.events.push(RecordingEvent {
            time: duration,
            event_type: "crash_recovery".to_string(),
            value: None,
        });

        if let Err(e) = write_metadata(&metadata_path, &metadata) {
            tracing::error!("Failed to update metadata for recovery: {}", e);
            continue;
        }

        let source_size = std::fs::metadata(&source_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let translation_size = std::fs::metadata(&translation_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let total_size = (source_size + translation_size) as i64;

        if let Ok(conn) = db.conn() {
            let _ = conn.execute(
                "UPDATE recordings SET duration_seconds = ?1, size_bytes = ?2 WHERE session_id = ?3",
                rusqlite::params![duration, total_size, metadata.session_id],
            );
            let _ = conn.execute(
                "UPDATE sessions SET state = 'failed', ended_at = ?1 WHERE id = ?2 AND state NOT IN ('completed', 'failed')",
                rusqlite::params![
                    chrono::Utc::now().to_rfc3339(),
                    metadata.session_id
                ],
            );
        }

        recovered += 1;
        tracing::warn!(
            "Recovered recording for session {} with duration {:.1}s",
            metadata.session_id,
            duration
        );
    }

    if recovered > 0 {
        tracing::warn!("Recovered {} incomplete recording(s)", recovered);
    }

    Ok(recovered)
}

fn read_duration_from_ogg(path: &Path) -> f64 {
    match read_last_granule_position(path) {
        Ok(Some(granule)) => granule as f64 / OPUS_SAMPLE_RATE,
        _ => 0.0,
    }
}

fn write_metadata(path: &Path, metadata: &RecordingMetadata) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(metadata)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
