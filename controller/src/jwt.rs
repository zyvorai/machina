// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

const ISSUER: &str = "machina-controller";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
    #[serde(default = "default_iss")]
    pub iss: String,
    /// `oidc`, `saml`, or `local` when issued from federated login.
    #[serde(default)]
    pub auth: Option<String>,
}

fn default_iss() -> String {
    ISSUER.to_string()
}

pub fn issue_token(
    secret: &str,
    username: &str,
    role: &str,
    ttl_secs: i64,
    auth: Option<&str>,
) -> anyhow::Result<String> {
    let now = chrono::Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: username.to_string(),
        role: role.to_string(),
        iat: now,
        exp: now + ttl_secs.max(60) as usize,
        iss: ISSUER.to_string(),
        auth: auth.map(str::to_string),
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_token(secret: &str, token: &str) -> anyhow::Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    let claims = data.claims;
    // Tokens without iss use the serde default "machina-controller" (backwards-compatible).
    // Tokens explicitly issued by another service (wrong iss) are rejected.
    if claims.iss != ISSUER {
        anyhow::bail!("JWT issuer mismatch: expected {ISSUER}, got {}", claims.iss);
    }
    Ok(claims)
}
