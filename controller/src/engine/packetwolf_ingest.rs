// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Tetragon event ingest relay — local sensor registry + optional PacketWolf dev fabric forward.

use axum::http::HeaderMap;
use serde_json::{json, Value};

use crate::config::ControllerConfig;
use crate::engine::packetwolf_bridge::{self, dev_fabric_available};

pub fn ingest_authorized(headers: &HeaderMap, remote_addr: Option<&str>) -> bool {
    if std::env::var("MACHINA_SKIP_AUTH").ok().as_deref() == Some("1") {
        return true;
    }
    if let Some(key) = std::env::var("MACHINA_INGEST_KEY").ok().filter(|k| !k.is_empty()) {
        let header_key = headers
            .get("x-machina-ingest-key")
            .or_else(|| headers.get("x-api-key"))
            .and_then(|v| v.to_str().ok());
        if header_key == Some(key.as_str()) {
            return true;
        }
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
    let url = format!(
        "{}/{}",
        cfg.packetwolf_base_url.trim_end_matches('/'),
        format!("api/v1/ingest/{host_id}")
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
