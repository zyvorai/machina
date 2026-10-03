// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Tetragon event ingest relay — local sensor registry + optional PacketWolf dev fabric forward.

use axum::http::HeaderMap;
use serde_json::{json, Value};

use crate::config::ControllerConfig;
use crate::engine::packetwolf_bridge::{self, dev_fabric_available};

/// Constant-time byte comparison to avoid leaking the ingest key via timing.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn ingest_authorized(headers: &HeaderMap, remote_addr: Option<&str>) -> bool {
    if std::env::var("MACHINA_SKIP_AUTH").ok().as_deref() == Some("1") {
        return true;
    }
    // SECURITY: when an ingest key is configured, it is the ONLY accepted proof of
    // authorization — do NOT fall back to trusting a loopback peer. In the normal
    // deployment the controller sits behind a co-located reverse proxy, so every
    // request's peer is 127.0.0.1; loopback-trust would then downgrade the admin gate
    // to "any authenticated user can inject/flood Tetragon events". Loopback is only a
    // dev convenience when no key is set at all.
    if let Some(key) = std::env::var("MACHINA_INGEST_KEY").ok().filter(|k| !k.is_empty()) {
        let header_key = headers
            .get("x-machina-ingest-key")
            .or_else(|| headers.get("x-api-key"))
            .and_then(|v| v.to_str().ok());
        return matches!(header_key, Some(hk) if ct_eq(hk.as_bytes(), key.as_bytes()));
    }
    if let Some(addr) = remote_addr {
        let host = addr
            .trim_start_matches('[')
            .split(']')
            .nth(1)
            .unwrap_or(addr)
            .rsplit_once(':')
            .map(|(h, _)| h)
            .unwrap_or(addr);
        if host == "127.0.0.1" || host == "::1" || host == "localhost" {
            return true;
        }
    }
    false
}

pub async fn relay_tetragon_batch(
    cfg: &ControllerConfig,
    host_id: &str,
    body: &Value,
) -> Value {
    if !cfg.packetwolf_enabled || !dev_fabric_available(cfg).await {
        return json!({
            "forwarded": false,
            "reason": "dev_fabric_unavailable",
            "target": packetwolf_bridge::ingest_base_url(cfg),
        });
    }
    // SECURITY: host_id is attacker/sensor-influenced (it comes straight off the
    // ingest URL path, not a validated UUID — see api/zeus_security.rs's
    // ingest_tetragon_events). Percent-encode it before splicing into the outbound
    // path so a crafted host_id ("../", "?", "#", ...) can't redirect the relay to
    // a different path/query on the trusted PacketWolf host.
    let url = format!(
        "{}/api/v1/ingest/{}",
        cfg.packetwolf_base_url.trim_end_matches('/'),
        urlencoding::encode(host_id)
    );
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(cfg.packetwolf_insecure_tls)
        .build()
    else {
        return json!({"forwarded": false, "reason": "http_client_error"});
    };
    let mut req = client.post(&url).json(body);
    if let Some(key) = cfg
        .packetwolf_api_key
        .as_deref()
        .filter(|k| !k.is_empty())
    {
        req = req
            .header("Authorization", format!("Bearer {key}"))
            .header("X-Api-Key", key);
    }
    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            json!({"forwarded": true, "target": url, "status": resp.status().as_u16()})
        }
        Ok(resp) => json!({
            "forwarded": false,
            "target": url,
            "status": resp.status().as_u16(),
            "reason": "upstream_rejected",
        }),
        Err(e) => json!({
            "forwarded": false,
            "target": url,
            "reason": e.to_string(),
        }),
    }
}
