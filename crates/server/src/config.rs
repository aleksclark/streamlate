use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_server")]
    pub server: ServerConfig,
    #[serde(default = "default_database")]
    pub database: DatabaseConfig,
    #[serde(default = "default_auth")]
    pub auth: AuthConfig,
    #[serde(default = "default_logging")]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_bind")]
    pub bind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,
    #[serde(default = "default_access_token_ttl")]
    pub access_token_ttl_seconds: u64,
    #[serde(default = "default_refresh_token_ttl")]
    pub refresh_token_ttl_seconds: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_log_format")]
    pub format: String,
}

fn default_server() -> ServerConfig {
    ServerConfig {
        bind: default_bind(),
    }
}

fn default_database() -> DatabaseConfig {
    DatabaseConfig {
        path: default_db_path(),
    }
}

fn default_auth() -> AuthConfig {
    AuthConfig {
        jwt_secret: default_jwt_secret(),
        access_token_ttl_seconds: default_access_token_ttl(),
        refresh_token_ttl_seconds: default_refresh_token_ttl(),
    }
}

fn default_logging() -> LoggingConfig {
    LoggingConfig {
        level: default_log_level(),
        format: default_log_format(),
    }
}

fn default_bind() -> String {
    "0.0.0.0:8080".to_string()
}

fn default_db_path() -> String {
    "streamlate.db".to_string()
}

fn default_jwt_secret() -> String {
    "change-me-in-production".to_string()
}

fn default_access_token_ttl() -> u64 {
    900
}

fn default_refresh_token_ttl() -> u64 {
    604800
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_log_format() -> String {
    "pretty".to_string()
}

impl AppConfig {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let builder = config::Config::builder()
            .add_source(config::File::with_name(path).required(false))
            .add_source(
                config::Environment::with_prefix("STREAMLATE")
                    .separator("_")
                    .try_parsing(true),
            );

        let settings = builder.build()?;
        let mut cfg: AppConfig = settings.try_deserialize().unwrap_or_else(|_| AppConfig {
            server: default_server(),
            database: default_database(),
            auth: default_auth(),
            logging: default_logging(),
        });

        if let Ok(v) = std::env::var("STREAMLATE_BIND") {
            cfg.server.bind = v;
        }
        if let Ok(v) = std::env::var("STREAMLATE_DB_PATH") {
            cfg.database.path = v;
        }
        if let Ok(v) = std::env::var("STREAMLATE_JWT_SECRET") {
            cfg.auth.jwt_secret = v;
        }
        if let Ok(v) = std::env::var("STREAMLATE_LOG_LEVEL") {
            cfg.logging.level = v;
        }
        if let Ok(v) = std::env::var("STREAMLATE_LOG_FORMAT") {
            cfg.logging.format = v;
        }
        if let Ok(v) = std::env::var("STREAMLATE_ACCESS_TOKEN_TTL") {
            if let Ok(n) = v.parse() {
                cfg.auth.access_token_ttl_seconds = n;
            }
        }
        if let Ok(v) = std::env::var("STREAMLATE_REFRESH_TOKEN_TTL") {
            if let Ok(n) = v.parse() {
                cfg.auth.refresh_token_ttl_seconds = n;
            }
        }

        Ok(cfg)
    }
}
