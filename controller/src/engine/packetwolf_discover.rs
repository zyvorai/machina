// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Discover PacketWolf API URL via kubeconfig (kubectl) or local health probes.

use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::config::ControllerConfig;

#[derive(Debug, Clone)]
pub struct DiscoveredEndpoint {
    pub base_url: String,
    pub source: String,
    pub namespace: Option<String>,
    pub service: Option<String>,
}

fn auto_discover_enabled() -> bool {
    std::env::var("PACKETWOLF_AUTO_DISCOVER")
        .map(|v| !matches!(v.to_lowercase().as_str(), "0" | "false" | "no"))
        .unwrap_or(true)
}

fn probe_health(base_url: &str, insecure_tls: bool) -> bool {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .danger_accept_invalid_certs(insecure_tls)
        .build()
    else {
        return false;
    };
    let url = format!("{}/health", base_url.trim_end_matches('/'));
    client
        .get(&url)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn localhost_candidates() -> Vec<String> {
    let mut urls = vec![
        "http://127.0.0.1:9191".into(),
        "http://127.0.0.1:9091".into(),
        "http://localhost:9191".into(),
    ];
    if let Ok(extra) = std::env::var("PACKETWOLF_LOCAL_URLS") {
        for part in extra.split(',') {
            let u = part.trim();
            if !u.is_empty() {
                urls.push(u.to_string());
            }
        }
    }
    urls
}

fn kubectl_available() -> bool {
    Command::new("kubectl")
        .args(["version", "--client", "-o", "json"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn discover_namespaces() -> Vec<String> {
    let mut ns = vec![
        std::env::var("PACKETWOLF_K8S_NAMESPACE").unwrap_or_else(|_| "packetwolf".into()),
        "cilium-system".into(),
        "kube-system".into(),
    ];
    if let Ok(extra) = std::env::var("PACKETWOLF_K8S_NAMESPACES") {
        for part in extra.split(',') {
            let n = part.trim();
            if !n.is_empty() && !ns.contains(&n.to_string()) {
                ns.push(n.to_string());
            }
        }
    }
    ns
}

fn is_packetwolf_api_service(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("packetwolf") && (n.contains("api") || n == "packetwolf")
}

fn url_from_service(item: &Value) -> Option<DiscoveredEndpoint> {
    let meta = item.get("metadata")?;
    let name = meta.get("name")?.as_str()?;
    if !is_packetwolf_api_service(name) {
        return None;
    }
    let namespace = meta
        .get("namespace")
        .and_then(|v| v.as_str())
        .map(String::from);
    let spec = item.get("spec")?;
    let ports = spec.get("ports")?.as_array()?;
    let port = ports
        .iter()
        .find_map(|p| {
            p.get("port")
                .and_then(|v| v.as_u64())
                .or_else(|| p.get("targetPort").and_then(|v| v.as_u64()))
        })
        .unwrap_or(9191);

    if let Some(lb) = spec
        .get("type")
        .and_then(|v| v.as_str())
        .filter(|t| *t == "LoadBalancer")
    {
        let _ = lb;
        if let Some(ingress) = spec.pointer("/status/loadBalancer/ingress/0") {
            let host = ingress
                .get("ip")
                .or_else(|| ingress.get("hostname"))
                .and_then(|v| v.as_str())?;
            return Some(DiscoveredEndpoint {
                base_url: format!("http://{host}:{port}"),
                source: "k8s-loadbalancer".into(),
                namespace: namespace.clone(),
                service: Some(name.to_string()),
            });
        }
    }

    if spec.get("type").and_then(|v| v.as_str()) == Some("NodePort") {
        let node_port = ports
            .iter()
            .find_map(|p| p.get("nodePort").and_then(|v| v.as_u64()))?;
        if let Some(node_ip) = first_node_internal_ip() {
            return Some(DiscoveredEndpoint {
                base_url: format!("http://{node_ip}:{node_port}"),
                source: "k8s-nodeport".into(),
                namespace,
                service: Some(name.to_string()),
            });
        }
    }

    None
}

fn first_node_internal_ip() -> Option<String> {
    let output = Command::new("kubectl")
        .args([
            "get",
            "nodes",
            "-o",
            "jsonpath={.items[0].status.addresses[?(@.type==\"InternalIP\")].address}",
            "--request-timeout=5s",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if ip.is_empty() {
        return None;
    }
    Some(ip)
}

fn discover_via_kubectl_all_namespaces() -> Option<DiscoveredEndpoint> {
    let output = Command::new("kubectl")
        .args(["get", "svc", "-A", "-o", "json", "--request-timeout=8s"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let body: Value = serde_json::from_slice(&output.stdout).ok()?;
    let items = body.get("items")?.as_array()?;
    for item in items {
        if let Some(ep) = url_from_service(item) {
            return Some(ep);
        }
    }
    None
}

fn discover_via_kubectl_targeted() -> Option<DiscoveredEndpoint> {
    for ns in discover_namespaces() {
        for svc_name in ["packetwolf-api", "packetwolf-packetwolf-api"] {
            let output = Command::new("kubectl")
                .args([
                    "get",
                    "svc",
                    svc_name,
                    "-n",
                    &ns,
                    "-o",
                    "json",
                    "--request-timeout=5s",
                ])
                .output()
                .ok()?;
            if !output.status.success() {
                continue;
            }
            let item: Value = serde_json::from_slice(&output.stdout).ok()?;
            if let Some(ep) = url_from_service(&item) {
                return Some(ep);
            }
        }
    }
    None
}

/// Blocking discovery — call from spawn_blocking.
pub fn discover_blocking(insecure_tls: bool) -> Option<DiscoveredEndpoint> {
    for url in localhost_candidates() {
        if probe_health(&url, insecure_tls) {
            return Some(DiscoveredEndpoint {
                base_url: url,
                source: "localhost".into(),
                namespace: None,
                service: None,
            });
        }
    }
    if !kubectl_available() {
        return None;
    }
    for discover_fn in [
        discover_via_kubectl_targeted,
        discover_via_kubectl_all_namespaces,
    ] {
        if let Some(ep) = discover_fn() {
            if probe_health(&ep.base_url, insecure_tls) {
                return Some(ep);
            }
        }
    }
    None
}

/// Overlay discovered PacketWolf URL when auto-discover is on and configured URL is down.
pub fn effective_config(cfg: &ControllerConfig) -> (ControllerConfig, Option<DiscoveredEndpoint>) {
    let mut effective = cfg.clone();
    if !auto_discover_enabled() {
        return (effective, None);
    }
    let configured_ok = cfg.packetwolf_enabled
        && probe_health(&cfg.packetwolf_base_url, cfg.packetwolf_insecure_tls);
    if configured_ok {
        return (effective, None);
    }
    let discovered = discover_blocking(cfg.packetwolf_insecure_tls);
    if let Some(ref ep) = discovered {
        effective.packetwolf_base_url = ep.base_url.clone();
        effective.packetwolf_enabled = true;
    }
    (effective, discovered)
}

pub async fn effective_config_async(
    cfg: &ControllerConfig,
) -> (ControllerConfig, Option<DiscoveredEndpoint>) {
    let base = cfg.clone();
    let fallback = cfg.clone();
    tokio::task::spawn_blocking(move || effective_config(&base))
        .await
        .unwrap_or((fallback, None))
}
