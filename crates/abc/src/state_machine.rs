use std::fmt;

#[derive(Debug, Clone)]
pub enum AbcState {
    Booting,
    ConnectingServer,
    Idle {
        signaling_url: String,
    },
    Reconnecting {
        reason: String,
    },
    #[allow(dead_code)]
    Error(String),
}

impl fmt::Display for AbcState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AbcState::Booting => write!(f, "booting"),
            AbcState::ConnectingServer => write!(f, "connecting_server"),
            AbcState::Idle { .. } => write!(f, "idle"),
            AbcState::Reconnecting { reason } => write!(f, "reconnecting: {reason}"),
            AbcState::Error(msg) => write!(f, "error: {msg}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_display() {
        assert_eq!(AbcState::Booting.to_string(), "booting");
        assert_eq!(AbcState::ConnectingServer.to_string(), "connecting_server");
        assert_eq!(
            AbcState::Idle {
                signaling_url: "ws://localhost/ws".into()
            }
            .to_string(),
            "idle"
        );
        assert_eq!(
            AbcState::Reconnecting {
                reason: "timeout".into()
            }
            .to_string(),
            "reconnecting: timeout"
        );
        assert_eq!(
            AbcState::Error("bad".into()).to_string(),
            "error: bad"
        );
    }
}
