// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// PacketWolf Security Fabric bridge for Zeus OS.

use serde::Serialize;
use serde_json::Value;

use crate::config::ControllerConfig;
use crate::engine::packetwolf_discover::{self, DiscoveredEndpoint};
use crate::engine::packetwolf_local;

#[derive(Debug, Clone, Serialize)]
pub struct PacketwolfStatus {
    pub enabled: bool,
    pub base_url: String,
    pub reachable: bool,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovery_source: Option<String>,
}

pub async fn resolved_config(
    cfg: &ControllerConfig,
) -> (ControllerConfig, Option<DiscoveredEndpoint>) {
    packetwolf_discover::effective_config_async(cfg).await
}

pub fn status_with_discovery(
    cfg: &ControllerConfig,
    discovery: Option<&DiscoveredEndpoint>,
) -> PacketwolfStatus {
    let (reachable, storage) = if cfg.packetwolf_enabled {
        fetch_health(&cfg.packetwolf_base_url, cfg.packetwolf_insecure_tls)
    } else {
        (false, None)
    };
    let mut summary = if !cfg.packetwolf_enabled {
        "PacketWolf fabric disabled — set PACKETWOLF_ENABLED=1 or ensure kubeconfig can reach PacketWolf API".into()
    } else if reachable {
        "PacketWolf connected — eBPF security fabric live".into()
    } else {
        "PacketWolf configured but unreachable — start packetwolf service on port 9091".into()
    };
    if let Some(d) = discovery {
        summary = format!("{summary} (discovered via {})", d.source);
    }
    if let Some(st) = storage.as_ref() {
        if st
            .get("clickhouse")
            .and_then(|c| c.get("reachable"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            summary = format!("{summary} · ClickHouse hot storage");
        }
        if st
            .get("opensearch")
            .and_then(|c| c.get("reachable"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            summary = format!("{summary} · OpenSearch hunt index");
        }
    }
    PacketwolfStatus {
        enabled: cfg.packetwolf_enabled,
        base_url: cfg.packetwolf_base_url.clone(),
        reachable,
        summary,
        storage,
        discovery_source: discovery.map(|d| d.source.clone()),
    }
}

pub fn status(cfg: &ControllerConfig) -> PacketwolfStatus {
    status_with_discovery(cfg, None)
}

/// Async wrapper — safe to call from async context (uses spawn_blocking internally).
pub async fn status_async(cfg: &ControllerConfig) -> PacketwolfStatus {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || status(&cfg))
        .await
        .unwrap_or_else(|_| PacketwolfStatus {
            enabled: false,
            base_url: String::new(),
            reachable: false,
            summary: "status check failed".into(),
            storage: None,
            discovery_source: None,
        })
}

/// Async wrapper with discovery — safe to call from async context (uses spawn_blocking internally).
pub async fn status_async_with_discovery(
    cfg: &ControllerConfig,
    discovery: Option<DiscoveredEndpoint>,
) -> PacketwolfStatus {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || status_with_discovery(&cfg, discovery.as_ref()))
        .await
        .unwrap_or_else(|_| PacketwolfStatus {
            enabled: false,
            base_url: String::new(),
            reachable: false,
            summary: "status check failed".into(),
            storage: None,
            discovery_source: None,
        })
}

fn fetch_health(base_url: &str, insecure_tls: bool) -> (bool, Option<Value>) {
    let Ok(client) = build_client(insecure_tls, 5) else {
        return (false, None);
    };
    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let Ok(resp) = client.get(&url).send() else {
        return (false, None);
    };
    if !resp.status().is_success() {
        return (false, None);
    }
    let body: Value = resp.json().unwrap_or(Value::Null);
    let storage = body.get("storage").cloned();
    (true, storage)
}

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

fn auth_headers(
    cfg: &ControllerConfig,
    req: reqwest::blocking::RequestBuilder,
) -> reqwest::blocking::RequestBuilder {
    if let Some(key) = cfg.packetwolf_api_key.as_deref().filter(|k| !k.is_empty()) {
        req.header("Authorization", format!("Bearer {key}"))
            .header("X-Api-Key", key)
    } else {
        req
    }
}

pub fn ingest_base_url(cfg: &ControllerConfig) -> String {
    if cfg.packetwolf_enabled && fabric_api_available(cfg) {
        packetwolf_ingest_base_url(cfg)
    } else if cfg.packetwolf_enabled {
        format!("http://127.0.0.1:{}/api/v1/zeus-security/ingest", cfg.port)
    } else {
        "http://127.0.0.1:9091/api/v1/ingest".into()
    }
}

fn packetwolf_ingest_base_url(cfg: &ControllerConfig) -> String {
    if cfg.packetwolf_enabled {
        format!(
            "{}/api/v1/ingest",
            cfg.packetwolf_base_url.trim_end_matches('/')
        )
    } else {
        "http://127.0.0.1:9091/api/v1/ingest".into()
    }
}

fn is_fabric_sensors_json(value: &Value) -> bool {
    value.get("sensors").map(|v| v.is_array()).unwrap_or(false)
}

fn is_production_anomalies_json(value: &Value) -> bool {
    value.get("anomalies").map(|v| v.is_array()).unwrap_or(false)
}

/// Dev fabric (machina/packetwolf Python service): sensors, hunt, enforcement, ingest.
pub fn dev_fabric_api_available(cfg: &ControllerConfig) -> bool {
    get_json(cfg, "/api/v1/sensors").is_some_and(|v| is_fabric_sensors_json(&v))
}

/// Production PacketWolf (Rust web-api): network intelligence, anomalies, runtime enforcement.
pub fn production_network_api_available(cfg: &ControllerConfig) -> bool {
    get_json(cfg, "/api/v1/anomalies?limit=1")
        .is_some_and(|v| is_production_anomalies_json(&v))
}

pub fn fabric_api_available(cfg: &ControllerConfig) -> bool {
    dev_fabric_api_available(cfg)
}

/// Async wrapper — safe to call from async context (uses spawn_blocking internally).
pub async fn dev_fabric_available(cfg: &ControllerConfig) -> bool {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || dev_fabric_api_available(&cfg))
        .await
        .unwrap_or(false)
}

/// Async wrapper — safe to call from async context (uses spawn_blocking internally).
pub async fn production_network_available(cfg: &ControllerConfig) -> bool {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || production_network_api_available(&cfg))
        .await
        .unwrap_or(false)
}

fn get_json(cfg: &ControllerConfig, path: &str) -> Option<Value> {
    if !cfg.packetwolf_enabled {
        return None;
    }
    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return None;
    };
    let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
    auth_headers(cfg, client.get(&url))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
}

fn post_json(cfg: &ControllerConfig, path: &str, body: Value) -> Option<Value> {
    if !cfg.packetwolf_enabled {
        return None;
    }
    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return None;
    };
    let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
    auth_headers(cfg, client.post(&url).json(&body))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
}

fn patch_json(cfg: &ControllerConfig, path: &str, body: Value) -> Option<Value> {
    if !cfg.packetwolf_enabled {
        return None;
    }
    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return None;
    };
    let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
    auth_headers(cfg, client.patch(&url).json(&body))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
}

fn delete_json(cfg: &ControllerConfig, path: &str) -> Option<Value> {
    if !cfg.packetwolf_enabled {
        return None;
    }
    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return None;
    };
    let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
    auth_headers(cfg, client.delete(&url))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
}

fn put_json(cfg: &ControllerConfig, path: &str, body: Value) -> Option<Value> {
    if !cfg.packetwolf_enabled {
        return None;
    }
    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return None;
    };
    let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
    auth_headers(cfg, client.put(&url).json(&body))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
}

pub async fn fabric_get(cfg: &ControllerConfig, path: &str) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        get_json(&cfg, &path).unwrap_or_else(|| serde_json::json!({}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({}))
}

pub async fn fabric_post(cfg: &ControllerConfig, path: &str, body: Value) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        post_json(&cfg, &path, body).unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn fabric_patch(cfg: &ControllerConfig, path: &str, body: Value) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        patch_json(&cfg, &path, body).unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn fabric_delete(cfg: &ControllerConfig, path: &str) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        delete_json(&cfg, &path).unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn fabric_put(cfg: &ControllerConfig, path: &str, body: Value) -> Value {
    let cfg = cfg.clone();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        put_json(&cfg, &path, body).unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn fetch_activity(
    cfg: &ControllerConfig,
    target_id: &str,
    hours: u32,
) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return placeholder_activity(target_id, hours, "PacketWolf disabled");
    }
    let path = format!("/api/v1/hosts/{target_id}/timeline?hours={hours}&limit=50");
    if let Some(timeline) = {
        let cfg = cfg.clone();
        tokio::task::spawn_blocking(move || get_json(&cfg, &path))
            .await
            .ok()
            .flatten()
    } {
        let events = timeline
            .get("events")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        let stats_path = format!("/api/v1/flows/stats?host_id={target_id}");
        let stats = {
            let cfg = cfg.clone();
            tokio::task::spawn_blocking(move || get_json(&cfg, &stats_path))
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| serde_json::json!({}))
        };
        let blocked = stats.get("dropped").and_then(|v| v.as_u64()).unwrap_or(0);
        let allowed = stats.get("forwarded").and_then(|v| v.as_u64()).unwrap_or(0);
        return serde_json::json!({
            "target_id": target_id,
            "hours": hours,
            "blocked_today": blocked,
            "allowed_today": allowed,
            "events": events,
            "stats": stats,
            "source": "packetwolf"
        });
    }
    fetch_activity_legacy(cfg, target_id, hours).await
}

async fn fetch_activity_legacy(
    cfg: &ControllerConfig,
    target_id: &str,
    hours: u32,
) -> serde_json::Value {
    let cfg = cfg.clone();
    let target_id = target_id.to_string();
    let fallback_id = target_id.clone();
    tokio::task::spawn_blocking(move || fetch_activity_blocking(&cfg, &target_id, hours))
        .await
        .unwrap_or_else(|_| placeholder_activity(&fallback_id, hours, "PacketWolf fetch failed"))
}

fn fetch_activity_blocking(
    cfg: &ControllerConfig,
    target_id: &str,
    hours: u32,
) -> serde_json::Value {
    let base = cfg.packetwolf_base_url.trim_end_matches('/');
    let stats_url = format!("{base}/api/v1/flows/stats?host_id={target_id}");
    let flows_url = format!("{base}/api/v1/flows?host_id={target_id}&limit=50");

    let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 15) else {
        return placeholder_activity(target_id, hours, "HTTP client error");
    };

    let stats: Value = auth_headers(cfg, client.get(&stats_url))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let flows_body: Value = auth_headers(cfg, client.get(&flows_url))
        .send()
        .ok()
        .and_then(|r| r.json().ok())
        .unwrap_or_else(|| serde_json::json!({ "flows": [] }));

    let events = flows_body
        .get("flows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let blocked_today = stats
        .get("dropped")
        .or_else(|| stats.get("dropped_count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let allowed_today = stats
        .get("forwarded")
        .or_else(|| stats.get("allowed"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    serde_json::json!({
        "target_id": target_id,
        "hours": hours,
        "blocked_today": blocked_today,
        "allowed_today": allowed_today,
        "events": events,
        "stats": stats,
        "source": "packetwolf"
    })
}

fn placeholder_activity(target_id: &str, hours: u32, note: &str) -> serde_json::Value {
    serde_json::json!({
        "target_id": target_id,
        "hours": hours,
        "blocked_today": 0,
        "allowed_today": 0,
        "events": [],
        "note": note
    })
}

pub async fn start_capture(cfg: &ControllerConfig, target_id: &str) -> anyhow::Result<()> {
    if !cfg.packetwolf_enabled {
        anyhow::bail!("PacketWolf disabled");
    }
    let body = serde_json::json!({ "host_id": target_id, "duration_secs": 300 });
    let _ = fabric_post(cfg, "/api/v1/capture/start", body).await;
    Ok(())
}

pub async fn correlate_rules(
    cfg: &ControllerConfig,
    target_id: &str,
    rules_json: &serde_json::Value,
) -> Vec<serde_json::Value> {
    if !cfg.packetwolf_enabled {
        return vec![serde_json::json!({
            "kind": "unused_rule_hint",
            "summary": "Rule may be unused — enable PacketWolf for traffic correlation",
            "rules": rules_json
        })];
    }
    let stats = fabric_get(cfg, &format!("/api/v1/flows/stats?host_id={target_id}")).await;
    vec![serde_json::json!({
        "kind": "traffic_correlation",
        "target_id": target_id,
        "summary": "PacketWolf flow stats correlated with Zeus firewall rules",
        "flow_stats": stats,
        "rules": rules_json
    })]
}

pub async fn fetch_anomalies(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "anomalies": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/anomalies?limit=25").await
}

pub async fn fetch_fleet_flows(cfg: &ControllerConfig, limit: u32) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "flows": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, &format!("/api/v1/flows?limit={limit}")).await
}

pub async fn fetch_fleet_flow_stats(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({});
    }
    fabric_get(cfg, "/api/v1/flows/stats").await
}

pub async fn fetch_network_overview(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/network/overview").await
}

pub async fn fetch_network_service_map(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "nodes": [], "edges": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/network/service-map").await
}

pub async fn fetch_network_workloads(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "workloads": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/network/workloads").await
}

pub async fn fetch_network_timeline(cfg: &ControllerConfig, limit: u32) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "events": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, &format!("/api/v1/network/timeline?limit={limit}")).await
}

pub async fn fetch_network_threats(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "threats": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/network/threats").await
}

pub async fn fetch_network_top_talkers(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "talkers": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/network/top-talkers").await
}

pub async fn fetch_k8s_nodes(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "nodes": [], "note": "PacketWolf disabled" });
    }
    fabric_get(cfg, "/api/v1/nodes").await
}

pub async fn fetch_network_pulse_bundle(cfg: &ControllerConfig) -> serde_json::Value {
    if !cfg.packetwolf_enabled {
        return serde_json::json!({ "enabled": false });
    }
    let (
        overview,
        service_map,
        workloads,
        timeline,
        threats,
        top_talkers,
        nodes,
        flow_stats,
        anomalies,
    ) = tokio::join!(
        fetch_network_overview(cfg),
        fetch_network_service_map(cfg),
        fetch_network_workloads(cfg),
        fetch_network_timeline(cfg, 40),
        fetch_network_threats(cfg),
        fetch_network_top_talkers(cfg),
        fetch_k8s_nodes(cfg),
        fetch_fleet_flow_stats(cfg),
        fetch_anomalies(cfg),
    );
    serde_json::json!({
        "enabled": true,
        "overview": overview,
        "service_map": service_map,
        "workloads": workloads,
        "timeline": timeline,
        "threats": threats,
        "top_talkers": top_talkers,
        "k8s_nodes": nodes,
        "flow_stats": flow_stats,
        "anomalies": anomalies,
    })
}

pub async fn fleet_threat_summary(cfg: &ControllerConfig) -> serde_json::Value {
    if dev_fabric_available(cfg).await {
        return fabric_get(cfg, "/api/v1/fleet/threat-summary").await;
    }
    if production_network_available(cfg).await {
        return synthesize_production_fleet_threat(cfg).await;
    }
    fabric_get(cfg, "/api/v1/fleet/threat-summary").await
}

async fn synthesize_production_fleet_threat(cfg: &ControllerConfig) -> serde_json::Value {
    let threats = fabric_get(cfg, "/api/v1/network/threats").await;
    let anomalies = fabric_get(cfg, "/api/v1/anomalies?limit=25").await;
    let critical_count = threats
        .pointer("/meta/stats/critical")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total_threats = threats
        .pointer("/meta/stats/total")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let fleet_threat_score = if total_threats == 0 {
        0.0
    } else {
        ((critical_count as f64 / total_threats as f64) * 100.0).min(100.0)
    };
    let critical_events: Vec<Value> = anomalies
        .get("anomalies")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter(|a| {
                    a.get("severity")
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| s == "critical" || s == "high")
                })
                .take(10)
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    serde_json::json!({
        "fleet_threat_score": fleet_threat_score,
        "critical_events": critical_events,
        "threats": threats,
        "anomalies_total": anomalies
            .get("anomalies")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0),
        "source": "packetwolf-production",
        "api_mode": "production_network",
    })
}

pub async fn host_fabric(
    cfg: &ControllerConfig,
    host_id: &str,
    resource: &str,
    query: &str,
) -> serde_json::Value {
    let path = format!("/api/v1/hosts/{host_id}/{resource}{query}");
    fabric_get(cfg, &path).await
}

pub async fn search(
    cfg: &ControllerConfig,
    query: &str,
    host_id: Option<&str>,
) -> serde_json::Value {
    let production_mode = production_network_available(cfg).await && !dev_fabric_available(cfg).await;
    let body = if production_mode {
        serde_json::json!({
            "query": query,
            "limit": 50
        })
    } else {
        serde_json::json!({
            "query": query,
            "host_id": host_id,
            "limit": 50
        })
    };
    let path = if production_mode {
        "/api/v1/network/search"
    } else {
        "/api/v1/search"
    };
    fabric_post(cfg, path, body).await
}

pub async fn fabric_health(cfg: &ControllerConfig) -> serde_json::Value {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || {
        if dev_fabric_api_available(&cfg) {
            get_json(&cfg, "/api/v1/fabric/health").unwrap_or_else(|| serde_json::json!({}))
        } else {
            let (reachable, _) =
                fetch_health(&cfg.packetwolf_base_url, cfg.packetwolf_insecure_tls);
            let production = production_network_api_available(&cfg);
            packetwolf_local::fabric_health(&cfg, reachable, production)
        }
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({}))
}

pub async fn hunt_queries(cfg: &ControllerConfig) -> serde_json::Value {
    fabric_get(cfg, "/api/v1/hunt/queries").await
}

pub async fn run_hunt_query(
    cfg: &ControllerConfig,
    query_id: &str,
    host_id: Option<&str>,
) -> serde_json::Value {
    let path = if let Some(h) = host_id {
        format!("/api/v1/hunt/run/{query_id}?host_id={h}")
    } else {
        format!("/api/v1/hunt/run/{query_id}")
    };
    fabric_post(cfg, &path, serde_json::json!({})).await
}

pub async fn sensors(cfg: &ControllerConfig) -> serde_json::Value {
    let cfg = cfg.clone();
    tokio::task::spawn_blocking(move || {
        if fabric_api_available(&cfg) {
            get_json(&cfg, "/api/v1/sensors").unwrap_or_else(|| serde_json::json!({"sensors": []}))
        } else {
            packetwolf_local::sensors_response()
        }
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"sensors": []}))
}

pub async fn register_sensor(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    let path = format!("/api/v1/sensors/{host_id}/register?tetragon_version=1.7.0");
    let cfg = cfg.clone();
    let host_id = host_id.to_string();
    tokio::task::spawn_blocking(move || {
        if !cfg.packetwolf_enabled {
            return serde_json::json!({"ok": false});
        }
        if !fabric_api_available(&cfg) {
            return packetwolf_local::register_sensor(&host_id, "1.7.0");
        }
        let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 10) else {
            return serde_json::json!({"ok": false});
        };
        let url = format!("{}{}", cfg.packetwolf_base_url.trim_end_matches('/'), path);
        auth_headers(&cfg, client.post(&url))
            .send()
            .ok()
            .and_then(|r| r.json().ok())
            .map(|v: Value| {
                if v.get("ok").is_none() && v.get("host_id").is_some() {
                    serde_json::json!({"ok": true, "sensor": v})
                } else {
                    v
                }
            })
            .unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn asset_inventory(cfg: &ControllerConfig) -> serde_json::Value {
    fabric_get(cfg, "/api/v1/asset-inventory").await
}

pub async fn fleet_timeline(cfg: &ControllerConfig, hours: u32) -> serde_json::Value {
    if production_network_available(cfg).await && !dev_fabric_available(cfg).await {
        fabric_get(cfg, "/api/v1/network/timeline?limit=200").await
    } else {
        fabric_get(
            cfg,
            &format!("/api/v1/fleet/timeline?hours={hours}&limit=200"),
        )
        .await
    }
}

pub async fn correlations(cfg: &ControllerConfig) -> serde_json::Value {
    if production_network_available(cfg).await && !dev_fabric_available(cfg).await {
        fabric_get(cfg, "/api/v1/network/threat-threads").await
    } else {
        fabric_get(cfg, "/api/v1/correlations").await
    }
}

pub async fn enforcement_status(cfg: &ControllerConfig) -> serde_json::Value {
    crate::engine::packetwolf_enforcement::enforcement_status(cfg).await
}

pub async fn enforcement_policies(cfg: &ControllerConfig) -> serde_json::Value {
    crate::engine::packetwolf_enforcement::enforcement_policies(cfg).await
}

pub async fn create_enforcement_policy(
    cfg: &ControllerConfig,
    body: serde_json::Value,
) -> serde_json::Value {
    crate::engine::packetwolf_enforcement::create_enforcement_policy(cfg, body).await
}

pub async fn apply_enforcement_policy(
    cfg: &ControllerConfig,
    policy_id: &str,
    host_ids: &[String],
) -> serde_json::Value {
    crate::engine::packetwolf_enforcement::apply_enforcement_policy(cfg, policy_id, host_ids).await
}

pub async fn patch_enforcement_policy(
    cfg: &ControllerConfig,
    policy_id: &str,
    body: Value,
) -> Value {
    crate::engine::packetwolf_enforcement::patch_enforcement_policy(cfg, policy_id, body).await
}

pub async fn delete_enforcement_policy(cfg: &ControllerConfig, policy_id: &str) -> Value {
    crate::engine::packetwolf_enforcement::delete_enforcement_policy(cfg, policy_id).await
}

pub async fn enforcement_policy_tetragon(cfg: &ControllerConfig, policy_id: &str) -> Value {
    crate::engine::packetwolf_enforcement::enforcement_policy_tetragon(cfg, policy_id).await
}

pub async fn host_enforcement(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    fabric_get(cfg, &format!("/api/v1/hosts/{host_id}/enforcement")).await
}

pub async fn agent_bundle(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    let cfg = cfg.clone();
    let host_id = host_id.to_string();
    tokio::task::spawn_blocking(move || {
        if !cfg.packetwolf_enabled {
            return serde_json::json!({});
        }
        if fabric_api_available(&cfg) {
            get_json(&cfg, &format!("/api/v1/agents/{host_id}/bundle"))
                .unwrap_or_else(|| serde_json::json!({}))
        } else {
            packetwolf_local::agent_bundle(&host_id)
        }
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({}))
}

pub async fn ack_agent_bundle(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    let cfg = cfg.clone();
    let host_id = host_id.to_string();
    tokio::task::spawn_blocking(move || {
        if !cfg.packetwolf_enabled {
            return serde_json::json!({"ok": false});
        }
        if fabric_api_available(&cfg) {
            post_json(
                &cfg,
                &format!("/api/v1/agents/{host_id}/bundle/ack"),
                serde_json::json!({}),
            )
            .unwrap_or_else(|| serde_json::json!({"ok": false}))
        } else {
            packetwolf_local::ack_agent_bundle(&host_id)
        }
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

pub async fn queue_tetragon_install(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    let cfg = cfg.clone();
    let host_id = host_id.to_string();
    tokio::task::spawn_blocking(move || {
        if !cfg.packetwolf_enabled {
            return serde_json::json!({"ok": false});
        }
        if !fabric_api_available(&cfg) {
            let export_url = ingest_base_url(&cfg);
            return packetwolf_local::queue_tetragon_install(&host_id, &export_url);
        }
        let Ok(client) = build_client(cfg.packetwolf_insecure_tls, 10) else {
            return serde_json::json!({"ok": false});
        };
        let url = format!(
            "{}/api/v1/agents/{host_id}/tetragon/queue",
            cfg.packetwolf_base_url.trim_end_matches('/')
        );
        auth_headers(&cfg, client.post(&url))
            .send()
            .ok()
            .and_then(|r| r.json().ok())
            .unwrap_or_else(|| serde_json::json!({"ok": false}))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fabric_sensors_json_detection() {
        assert!(is_fabric_sensors_json(&serde_json::json!({"sensors": []})));
        assert!(!is_fabric_sensors_json(&serde_json::json!({"html": true})));
        assert!(!is_fabric_sensors_json(&serde_json::json!({})));
    }

    #[test]
    fn production_anomalies_json_detection() {
        assert!(is_production_anomalies_json(&serde_json::json!({"anomalies": []})));
        assert!(!is_production_anomalies_json(&serde_json::json!({"sensors": []})));
    }
}
