use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SignalingMessage {
    Welcome {
        session_id: Option<String>,
        #[serde(default)]
        abc_id: Option<String>,
    },
    SessionStart {
        session_id: String,
        session_name: String,
    },
    SessionStop {
        session_id: String,
    },
    Offer {
        sdp: String,
    },
    Answer {
        sdp: String,
    },
    IceCandidate {
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
    IceRestart,
    Mute {
        muted: bool,
    },
    Passthrough {
        enabled: bool,
    },
    Health {
        latency_ms: f64,
        packet_loss: f64,
        jitter_ms: f64,
        bitrate_kbps: f64,
    },
    Error {
        code: String,
        message: String,
    },
    Ping,
    Pong,
}
