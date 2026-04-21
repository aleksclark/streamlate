use crate::db::Database;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHasher};
use rand::rngs::OsRng;
use uuid::Uuid;

pub fn maybe_create_admin(db: &Database) -> anyhow::Result<()> {
    let conn = db.conn().map_err(|e| anyhow::anyhow!(e))?;

    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;

    if count > 0 {
        return Ok(());
    }

    let password = std::env::var("STREAMLATE_ADMIN_PASSWORD")
        .unwrap_or_else(|_| generate_password());
    let argon2 = Argon2::default();
    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?
        .to_string();

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, "admin@streamlate.local", hash, "Admin", "admin", now, now],
    )?;

    println!("========================================");
    println!("  FIRST RUN: Admin account created");
    println!("  Email:    admin@streamlate.local");
    println!("  Password: {}", password);
    println!("========================================");

    tracing::info!(
        "First-run bootstrap: created admin user admin@streamlate.local with password: {}",
        password
    );

    Ok(())
}

fn generate_password() -> String {
    use rand::Rng;
    let mut rng = OsRng;
    let chars: Vec<char> = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%"
        .chars()
        .collect();
    (0..16).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}
