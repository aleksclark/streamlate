use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingMetadata {
    pub session_id: String,
    pub session_name: String,
    pub translator_id: String,
    pub translator_name: String,
    pub abc_id: String,
    pub abc_name: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    pub source_file: String,
    pub translation_file: String,
    pub state: RecordingState,
    pub events: Vec<RecordingEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RecordingState {
    Recording,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingEvent {
    pub time: f64,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}
