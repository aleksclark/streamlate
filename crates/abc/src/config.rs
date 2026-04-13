use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AbcConfig {
    pub server: ServerConfig,
    pub identity: IdentityConfig,
    #[serde(default)]
    #[allow(dead_code)]
    pub audio: AudioConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IdentityConfig {
    pub abc_id: String,
    pub abc_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct AudioConfig {
    #[serde(default = "default_device")]
    pub capture_device: String,
    #[serde(default = "default_device")]
    pub playback_device: String,
    #[serde(default = "default_gain")]
    pub capture_gain: f32,
    #[serde(default = "default_gain")]
    pub playback_gain: f32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            capture_device: default_device(),
            playback_device: default_device(),
            capture_gain: default_gain(),
            playback_gain: default_gain(),
        }
    }
}

fn default_device() -> String {
    "default".to_string()
}

fn default_gain() -> f32 {
    1.0
}

pub fn load_config() -> anyhow::Result<AbcConfig> {
    if let Ok(url) = std::env::var("ABC_SERVER_URL") {
        let abc_id = std::env::var("ABC_ID").unwrap_or_default();
        let abc_secret = std::env::var("ABC_SECRET").unwrap_or_default();
        let mut audio = AudioConfig::default();
        if let Ok(dev) = std::env::var("ABC_CAPTURE_DEVICE") {
            audio.capture_device = dev;
        }
        if let Ok(dev) = std::env::var("ABC_PLAYBACK_DEVICE") {
            audio.playback_device = dev;
        }
        if let Ok(g) = std::env::var("ABC_CAPTURE_GAIN") {
            if let Ok(v) = g.parse::<f32>() {
                audio.capture_gain = v;
            }
        }
        if let Ok(g) = std::env::var("ABC_PLAYBACK_GAIN") {
            if let Ok(v) = g.parse::<f32>() {
                audio.playback_gain = v;
            }
        }
        return Ok(AbcConfig {
            server: ServerConfig { url },
            identity: IdentityConfig {
                abc_id,
                abc_secret,
            },
            audio,
        });
    }

    let config_path =
        std::env::var("ABC_CONFIG").unwrap_or_else(|_| "/etc/streamlate/abc.toml".to_string());

    if std::path::Path::new(&config_path).exists() {
        let content = std::fs::read_to_string(&config_path)?;
        let config: AbcConfig = toml::from_str(&content)?;
        return Ok(config);
    }

    anyhow::bail!(
        "No config found. Set ABC_SERVER_URL/ABC_ID/ABC_SECRET env vars or provide abc.toml"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_toml() {
        let toml = r#"
[server]
url = "http://localhost:3000"

[identity]
abc_id = "test-abc-1"
abc_secret = "sk_abc_test"
"#;
        let cfg: AbcConfig = toml::from_str(toml).unwrap();
        assert_eq!(cfg.server.url, "http://localhost:3000");
        assert_eq!(cfg.identity.abc_id, "test-abc-1");
        assert_eq!(cfg.identity.abc_secret, "sk_abc_test");
        assert_eq!(cfg.audio.capture_device, "default");
        assert_eq!(cfg.audio.capture_gain, 1.0);
    }

    #[test]
    fn parse_full_toml() {
        let toml = r#"
[server]
url = "https://streamlate.example.com"

[identity]
abc_id = "550e8400-e29b-41d4-a716-446655440000"
abc_secret = "sk_abc_secret123"

[audio]
capture_device = "hw:1,0"
playback_device = "hw:2,0"
capture_gain = 0.8
playback_gain = 1.2
"#;
        let cfg: AbcConfig = toml::from_str(toml).unwrap();
        assert_eq!(cfg.audio.capture_device, "hw:1,0");
        assert_eq!(cfg.audio.playback_device, "hw:2,0");
        assert!((cfg.audio.capture_gain - 0.8).abs() < f32::EPSILON);
        assert!((cfg.audio.playback_gain - 1.2).abs() < f32::EPSILON);
    }

    #[test]
    fn audio_config_defaults() {
        let cfg = AudioConfig::default();
        assert_eq!(cfg.capture_device, "default");
        assert_eq!(cfg.playback_device, "default");
        assert!((cfg.capture_gain - 1.0).abs() < f32::EPSILON);
        assert!((cfg.playback_gain - 1.0).abs() < f32::EPSILON);
    }
}
