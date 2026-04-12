use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    Translator,
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Role::Admin => write!(f, "admin"),
            Role::Translator => write!(f, "translator"),
        }
    }
}

impl std::str::FromStr for Role {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin" => Ok(Role::Admin),
            "translator" => Ok(Role::Translator),
            _ => Err(format!("invalid role: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Starting,
    Active,
    Paused,
    Passthrough,
    Completed,
    Failed,
}

impl fmt::Display for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionState::Starting => write!(f, "starting"),
            SessionState::Active => write!(f, "active"),
            SessionState::Paused => write!(f, "paused"),
            SessionState::Passthrough => write!(f, "passthrough"),
            SessionState::Completed => write!(f, "completed"),
            SessionState::Failed => write!(f, "failed"),
        }
    }
}

impl std::str::FromStr for SessionState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "starting" => Ok(SessionState::Starting),
            "active" => Ok(SessionState::Active),
            "paused" => Ok(SessionState::Paused),
            "passthrough" => Ok(SessionState::Passthrough),
            "completed" => Ok(SessionState::Completed),
            "failed" => Ok(SessionState::Failed),
            _ => Err(format!("invalid session state: {}", s)),
        }
    }
}
