use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::rngs::OsRng;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn create_access_token(
    user_id: &str,
    role: &str,
    secret: &str,
    ttl_seconds: u64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp: now + ttl_seconds as usize,
        iat: now,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn validate_access_token(
    token: &str,
    secret: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.leeway = 0;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

pub fn generate_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill(&mut bytes);
    hex::encode(bytes)
}

pub fn hash_refresh_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn generate_abc_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill(&mut bytes);
    format!("sk_abc_{}", hex::encode(bytes))
}

pub fn store_refresh_token(
    conn: &rusqlite::Connection,
    user_id: &str,
    token_hash: &str,
    ttl_seconds: u64,
) -> Result<String, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let expires_at = now + chrono::Duration::seconds(ttl_seconds as i64);

    conn.execute(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            id,
            user_id,
            token_hash,
            expires_at.to_rfc3339(),
            now.to_rfc3339()
        ],
    )?;
    Ok(id)
}

pub fn validate_refresh_token(
    conn: &rusqlite::Connection,
    token_hash: &str,
) -> Result<Option<(String, String)>, rusqlite::Error> {
    let result = conn.query_row(
        "SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?1",
        [token_hash],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    );

    match result {
        Ok((id, user_id, expires_at_str)) => {
            let expires_at = chrono::DateTime::parse_from_rfc3339(&expires_at_str)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now());

            if expires_at < chrono::Utc::now() {
                conn.execute("DELETE FROM refresh_tokens WHERE id = ?1", [&id])?;
                return Ok(None);
            }

            Ok(Some((id, user_id)))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn revoke_refresh_token(
    conn: &rusqlite::Connection,
    token_hash: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM refresh_tokens WHERE token_hash = ?1",
        [token_hash],
    )?;
    Ok(())
}

pub fn revoke_all_user_tokens(
    conn: &rusqlite::Connection,
    user_id: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM refresh_tokens WHERE user_id = ?1",
        [user_id],
    )?;
    Ok(())
}
