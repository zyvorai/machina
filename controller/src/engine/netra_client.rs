// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Netra (../netra) standalone eBPF enforcement client.
//
// Netra is a separate, real product from PacketWolf (see packetwolf_bridge.rs
// / packetwolf_enforcement.rs) — Netra's own docs describe the two as
// "counterparts, not a wired pipeline... no shared API, CRD, or install
// pair." This client speaks Netra's actual REST API (netrad, default
// :30870) directly: exact-IP/CIDR deny-list mutations and the leased
// enforce/observe kill-switch. It is not a drop-in for the packetwolf_bridge
// `fabric_*` helpers, which target a differently-shaped (and, absent a real
// fabric, nonexistent) runtime-enforcement API.

use serde_json::{json, Value};

use crate::config::ControllerConfig;

fn build_client(
    insecure_tls: bool,
    timeout_secs: u64,
) -> anyhow::Result<reqwest::blocking::Client> {
    let mut b =
        reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
    if insecure_tls {
        b = b.danger_accept_invalid_certs(true);
    }
    Ok(b.build()?)
}

fn auth(
    cfg: &ControllerConfig,
    req: reqwest::blocking::RequestBuilder,
) -> reqwest::blocking::RequestBuilder {
    if let Some(key) = cfg.netra_api_key.as_deref().filter(|k| !k.is_empty()) {
        req.header("Authorization", format!("Bearer {key}"))
    } else {
        req
    }
}

fn full_url(cfg: &ControllerConfig, path: &str) -> String {
    format!("{}{}", cfg.netra_base_url.trim_end_matches('/'), path)
}

/// A request Netra couldn't be reached for, or that it rejected, resolves to
/// `{"ok": false, "error": "..."}` — never a bare network exception a caller
/// could mistake for "nothing to do" (the same fail-closed contract
/// packetwolf_bridge's `fabric_*` helpers already use).
fn request_json(
    cfg: &ControllerConfig,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Value {
    if !cfg.netra_enabled {
        return json!({"ok": false, "error": "Netra integration disabled (NETRA_ENABLED unset)"});
    }
    let Ok(client) = build_client(cfg.netra_insecure_tls, 10) else {
        return json!({"ok": false, "error": "failed to build Netra HTTP client"});
    };
    let url = full_url(cfg, path);
    let mut req = client.request(method, &url);
    if let Some(b) = &body {
        req = req.json(b);
    }
    let resp = match auth(cfg, req).send() {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": format!("Netra unreachable: {e}")}),
    };
    let status = resp.status();
    let parsed: Value = resp.json().unwrap_or(Value::Null);
    if !status.is_success() {
        let err = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Netra rejected the request")
            .to_string();
        return json!({"ok": false, "error": err, "status": status.as_u16()});
    }
    match parsed {
        Value::Object(mut map) => {
            map.entry("ok").or_insert(json!(true));
            Value::Object(map)
        }
        other => json!({"ok": true, "data": other}),
    }
}

async fn netra_request(
    cfg: &ControllerConfig,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || request_json(&cfg, method, &path, body))
        .await
        .unwrap_or_else(|_| json!({"ok": false, "error": "Netra client task panicked"}))
}

/// `POST /api/v1/ebpf/deny` — add an exact-IP deny entry (egress/ingress/both).
pub async fn deny_add(cfg: &ControllerConfig, ip: &str, direction: &str) -> Value {
    netra_request(
        cfg,
        reqwest::Method::POST,
        "/api/v1/ebpf/deny",
        Some(json!({"ip": ip, "direction": direction})),
    )
    .await
}

/// `DELETE /api/v1/ebpf/deny/{ip}` — clears the entry from whichever
/// direction list(s) it's actually in.
pub async fn deny_delete(cfg: &ControllerConfig, ip: &str) -> Value {
    netra_request(
        cfg,
        reqwest::Method::DELETE,
        &format!(
            "/api/v1/ebpf/deny/{}",
            urlencoding::encode(ip.trim())
        ),
        None,
    )
    .await
}

/// `POST /api/v1/ebpf/cidr` — add a CIDR deny entry.
pub async fn cidr_add(cfg: &ControllerConfig, cidr: &str, direction: &str) -> Value {
    netra_request(
        cfg,
        reqwest::Method::POST,
        "/api/v1/ebpf/cidr",
        Some(json!({"cidr": cidr, "direction": direction})),
    )
    .await
}

/// `POST /api/v1/ebpf/cidr/delete` — remove a CIDR deny entry.
pub async fn cidr_delete(cfg: &ControllerConfig, cidr: &str, direction: &str) -> Value {
    netra_request(
        cfg,
        reqwest::Method::POST,
        "/api/v1/ebpf/cidr/delete",
        Some(json!({"cidr": cidr, "direction": direction})),
    )
    .await
}

/// `PUT /api/v1/ebpf/mode` — the leased enforce/observe kill-switch. Netra
/// fails back open to `observe` automatically once the lease expires, so a
/// controller crash or a forgotten detach can't leave enforcement stuck on.
pub async fn set_mode(cfg: &ControllerConfig, mode: &str, lease: Option<&str>) -> Value {
    let path = if mode == "enforce" {
        match lease {
            Some(l) if !l.is_empty() => format!("/api/v1/ebpf/mode?lease={l}"),
            _ => "/api/v1/ebpf/mode".to_string(),
        }
    } else {
        "/api/v1/ebpf/mode".to_string()
    };
    netra_request(
        cfg,
        reqwest::Method::PUT,
        &path,
        Some(json!({"mode": mode})),
    )
    .await
}

/// `GET /api/v1/ebpf/config` — current desired-state snapshot (deny/allow
/// lists, mode, lease expiry) as Netra itself sees it.
pub async fn config_snapshot(cfg: &ControllerConfig) -> Value {
    netra_request(cfg, reqwest::Method::GET, "/api/v1/ebpf/config", None).await
}

/// `GET /api/v1/status` — cluster/agent health board.
pub async fn status(cfg: &ControllerConfig) -> Value {
    netra_request(cfg, reqwest::Method::GET, "/api/v1/status", None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disabled_cfg() -> ControllerConfig {
        ControllerConfig {
            netra_enabled: false,
            ..ControllerConfig::default()
        }
    }

    #[tokio::test]
    async fn disabled_integration_fails_closed_without_a_network_call() {
        let cfg = disabled_cfg();
        let result = deny_add(&cfg, "203.0.113.5", "egress").await;
        assert_eq!(result["ok"], false);
        assert!(result["error"].as_str().unwrap().contains("disabled"));
    }

    #[tokio::test]
    async fn unreachable_base_url_fails_closed() {
        let cfg = ControllerConfig {
            netra_enabled: true,
            netra_base_url: "http://127.0.0.1:1".into(),
            ..ControllerConfig::default()
        };
        let result = deny_add(&cfg, "203.0.113.5", "egress").await;
        assert_eq!(result["ok"], false);
        assert!(result["error"].as_str().is_some());
    }
}
