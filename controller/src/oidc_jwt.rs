// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: Option<String>,
    kty: String,
    n: Option<String>,
    e: Option<String>,
    x: Option<String>,
    y: Option<String>,
    crv: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    sub: String,
    #[allow(dead_code)]
    iss: Option<String>,
    #[allow(dead_code)]
    aud: Option<serde_json::Value>,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
    nonce: Option<String>,
}

pub async fn validate_id_token(
    id_token: &str,
    issuer: &str,
    client_id: &str,
    jwks_uri: &str,
    expected_nonce: Option<&str>,
) -> anyhow::Result<String> {
    let header = decode_header(id_token)?;
    let alg = header.alg;
    let kid = header.kid.unwrap_or_default();

    let jwks: Jwks = reqwest::get(jwks_uri)
        .await?
        .error_for_status()?
        .json()
        .await?;
    let jwk = jwks
        .keys
        .into_iter()
        .find(|k| k.kid.as_deref().unwrap_or("") == kid || kid.is_empty())
        .ok_or_else(|| anyhow::anyhow!("JWKS key not found for kid={kid}"))?;

    let decoding_key = decoding_key_for_jwk(&jwk, alg)?;

    let mut validation = Validation::new(alg);
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[client_id]);
    validation.validate_exp = true;

    let data = decode::<IdClaims>(id_token, &decoding_key, &validation)?;

    if let Some(expected) = expected_nonce {
        match data.claims.nonce.as_deref() {
            Some(got) if got == expected => {}
            Some(got) => anyhow::bail!("id_token nonce mismatch: expected {expected:?}, got {got:?}"),
            None => anyhow::bail!("id_token missing nonce claim (replay protection requires nonce)"),
        }
    }

    let username = data
        .claims
        .email
        .or(data.claims.preferred_username)
        .or(data.claims.name)
        .unwrap_or(data.claims.sub);
    Ok(username)
}

fn decoding_key_for_jwk(jwk: &Jwk, alg: Algorithm) -> anyhow::Result<DecodingKey> {
    match (jwk.kty.as_str(), alg) {
        ("RSA", Algorithm::RS256) => {
            let n = jwk
                .n
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("JWKS RSA key missing n"))?;
            let e = jwk
                .e
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("JWKS RSA key missing e"))?;
            Ok(DecodingKey::from_rsa_components(n, e)?)
        }
        ("EC", Algorithm::ES256) => {
            let x = jwk
                .x
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("JWKS EC key missing x"))?;
            let y = jwk
                .y
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("JWKS EC key missing y"))?;
            let crv = jwk.crv.as_deref().unwrap_or("P-256");
            if crv != "P-256" {
                anyhow::bail!("unsupported EC curve: {crv}");
            }
            Ok(DecodingKey::from_ec_components(x, y)?)
        }
        (_, Algorithm::HS256) => anyhow::bail!("unsupported id_token algorithm: {alg:?}"),
        (_, other) => anyhow::bail!(
            "unsupported id_token algorithm/key: {other:?} / {}",
            jwk.kty
        ),
    }
}

pub fn parse_id_token_unverified(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("email")
        .or_else(|| v.get("preferred_username"))
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .or_else(|| v.get("sub").and_then(|x| x.as_str()).map(str::to_string))
}
