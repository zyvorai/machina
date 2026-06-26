// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Controller-local PacketWolf fabric fallback when production API lacks dev fabric routes.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::config::ControllerConfig;

pub const DEFAULT_TETRAGON_VERSION: &str = "1.7.0";

#[derive(Debug, Clone)]
struct LocalSensor {
    host_id: String,
    status: String,
    tetragon_version: String,
    registered_at: String,
    last_event_at: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingTetragonInstall {
    host_id: String,
    export_url: String,
    queued_at: String,
}

#[derive(Debug, Clone)]
struct LocalEnforcementPolicy {
    id: String,
    name: String,
    kind: String,
    match_value: String,
    enabled: bool,
    scope: String,
    description: String,
    applied_hosts: Vec<String>,
}

#[derive(Default)]
struct LocalFabricState {
    sensors: HashMap<String, LocalSensor>,
    pending_tetragon: HashMap<String, PendingTetragonInstall>,
    enforcement_policies: HashMap<String, LocalEnforcementPolicy>,
}

static LOCAL_FABRIC: LazyLock<RwLock<LocalFabricState>> =
    LazyLock::new(|| RwLock::new(LocalFabricState::default()));

pub fn load_from_rows(
    rows: Vec<(
        String,
        String,
        String,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
        Option<Value>,
    )>,
) {
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        state.sensors.clear();
        state.pending_tetragon.clear();
        for (host_id, status, tetragon_version, registered_at, last_event_at, pending) in rows {
            state.sensors.insert(
                host_id.clone(),
                LocalSensor {
                    host_id: host_id.clone(),
                    status,
                    tetragon_version,
                    registered_at: registered_at.to_rfc3339(),
                    last_event_at: last_event_at.map(|t| t.to_rfc3339()),
                },
            );
            if let Some(p) = pending {
                let export_url = p
                    .get("export_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !export_url.is_empty() {
                    state.pending_tetragon.insert(
                        host_id,
                        PendingTetragonInstall {
                            host_id: p
                                .get("host_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            export_url,
                            queued_at: now_iso(),
                        },
                    );
                }
            }
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn register_sensor(host_id: &str, tetragon_version: &str) -> Value {
    let sensor = LocalSensor {
        host_id: host_id.to_string(),
        status: "registered".into(),
        tetragon_version: tetragon_version.to_string(),
        registered_at: now_iso(),
        last_event_at: None,
    };
    let out = sensor_to_json(&sensor);
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        state.sensors.insert(host_id.to_string(), sensor);
    }
    json!({
        "ok": true,
        "host_id": host_id,
        "status": "registered",
        "tetragon_version": tetragon_version,
        "source": "machina-controller",
        "sensor": out,
    })
}

fn sensor_to_json(sensor: &LocalSensor) -> Value {
    json!({
        "host_id": sensor.host_id,
        "status": sensor.status,
        "tetragon_version": sensor.tetragon_version,
        "registered_at": sensor.registered_at,
        "last_event_at": sensor.last_event_at,
    })
}

pub fn list_sensors() -> Vec<Value> {
    LOCAL_FABRIC
        .read()
        .ok()
        .map(|state| state.sensors.values().map(sensor_to_json).collect())
        .unwrap_or_default()
}

pub fn mark_sensor_healthy(host_id: &str) {
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        if let Some(sensor) = state.sensors.get_mut(host_id) {
            sensor.status = "healthy".into();
            sensor.last_event_at = Some(now_iso());
        }
    }
}

pub fn record_events(host_id: &str, count: usize) {
    if count == 0 {
        return;
    }
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        if let Some(sensor) = state.sensors.get_mut(host_id) {
            sensor.status = "healthy".into();
            sensor.last_event_at = Some(now_iso());
        } else {
            state.sensors.insert(
                host_id.to_string(),
                LocalSensor {
                    host_id: host_id.to_string(),
                    status: "healthy".into(),
                    tetragon_version: DEFAULT_TETRAGON_VERSION.into(),
                    registered_at: now_iso(),
                    last_event_at: Some(now_iso()),
                },
            );
        }
    }
}

pub fn queue_tetragon_install(host_id: &str, export_url: &str) -> Value {
    let _ = register_sensor(host_id, DEFAULT_TETRAGON_VERSION);
    let bundle = json!({
        "host_id": host_id,
        "status": "queued",
        "install_unit": "tetragon.service",
        "export_url": export_url,
    });
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        state.pending_tetragon.insert(
            host_id.to_string(),
            PendingTetragonInstall {
                host_id: host_id.to_string(),
                export_url: export_url.to_string(),
                queued_at: now_iso(),
            },
        );
    }
    json!({
        "ok": true,
        "host_id": host_id,
        "source": "machina-controller",
        "bundle": bundle,
    })
}

pub fn agent_bundle(host_id: &str) -> Value {
    let (pending, sensor, tracing_policies, removed, policy_count) = LOCAL_FABRIC
        .read()
        .ok()
        .map(|state| {
            let tracing: Vec<Value> = state
                .enforcement_policies
                .values()
                .filter(|p| {
                    p.enabled
                        && (p.scope == "fleet"
                            || p.applied_hosts.iter().any(|h| h == host_id))
                })
                .map(|p| tetragon_policy_for_policy(p))
                .collect();
            let count = tracing.len();
            (
                state.pending_tetragon.get(host_id).map(|p| {
                    json!({
                        "host_id": p.host_id,
                        "status": "queued",
                        "install_unit": "tetragon.service",
                        "export_url": p.export_url,
                    })
                }),
                state.sensors.get(host_id).map(sensor_to_json),
                tracing,
                Vec::<String>::new(),
                count,
            )
        })
        .unwrap_or((None, None, vec![], vec![], 0));

    json!({
        "host_id": host_id,
        "tetragon_install": pending,
        "tracing_policies": tracing_policies,
        "removed_policies": removed,
        "policy_count": policy_count,
        "sensor": sensor,
        "source": "machina-controller",
    })
}

fn policy_to_json(policy: &LocalEnforcementPolicy) -> Value {
    json!({
        "id": policy.id,
        "name": policy.name,
        "kind": policy.kind,
        "match": policy.match_value,
        "enabled": policy.enabled,
        "scope": policy.scope,
        "description": policy.description,
        "applied_hosts": policy.applied_hosts,
        "backend": "machina-tetragon",
    })
}

pub fn list_enforcement_policies() -> Vec<Value> {
    LOCAL_FABRIC
        .read()
        .ok()
        .map(|state| {
            state
                .enforcement_policies
                .values()
                .map(policy_to_json)
                .collect()
        })
        .unwrap_or_default()
}

pub fn get_enforcement_policy(policy_id: &str) -> Option<Value> {
    LOCAL_FABRIC
        .read()
        .ok()
        .and_then(|state| state.enforcement_policies.get(policy_id).map(policy_to_json))
}

pub fn upsert_enforcement_policy(
    id: &str,
    name: &str,
    kind: &str,
    match_value: &str,
    enabled: bool,
    scope: &str,
    description: &str,
) -> Value {
    let policy = LocalEnforcementPolicy {
        id: id.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        match_value: match_value.to_string(),
        enabled,
        scope: scope.to_string(),
        description: description.to_string(),
        applied_hosts: Vec::new(),
    };
    let out = policy_to_json(&policy);
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        state.enforcement_policies.insert(id.to_string(), policy);
    }
    out
}

pub fn patch_enforcement_policy(policy_id: &str, body: &Value) -> Value {
    let mut out = json!({});
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        if let Some(policy) = state.enforcement_policies.get_mut(policy_id) {
            if let Some(enabled) = body.get("enabled").and_then(|v| v.as_bool()) {
                policy.enabled = enabled;
            }
            if let Some(m) = body.get("match").and_then(|v| v.as_str()) {
                policy.match_value = m.to_string();
            }
            if let Some(d) = body.get("description").and_then(|v| v.as_str()) {
                policy.description = d.to_string();
            }
            out = policy_to_json(policy);
        }
    }
    out
}

pub fn delete_enforcement_policy(policy_id: &str) -> Option<Value> {
    LOCAL_FABRIC
        .write()
        .ok()
        .and_then(|mut state| {
            state
                .enforcement_policies
                .remove(policy_id)
                .map(|p| policy_to_json(&p))
        })
}

pub fn mark_policy_applied(policy_id: &str, host_ids: &[String]) {
    if let Ok(mut state) = LOCAL_FABRIC.write() {
        if let Some(policy) = state.enforcement_policies.get_mut(policy_id) {
            for host_id in host_ids {
                if !policy.applied_hosts.contains(host_id) {
                    policy.applied_hosts.push(host_id.clone());
                }
            }
        }
    }
}

pub fn tetragon_policy_for(policy: &Value) -> Value {
    let kind = policy.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let match_value = policy.get("match").and_then(|v| v.as_str()).unwrap_or("");
    let id = policy
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("policy");
    tetragon_policy_for_policy(&LocalEnforcementPolicy {
        id: id.to_string(),
        name: policy
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string(),
        kind: kind.to_string(),
        match_value: match_value.to_string(),
        enabled: true,
        scope: "fleet".into(),
        description: String::new(),
        applied_hosts: Vec::new(),
    })
}

fn tetragon_policy_for_policy(policy: &LocalEnforcementPolicy) -> Value {
    let name = format!("packetwolf-{}", policy.id);
    let mut base = json!({
        "apiVersion": "cilium.io/v1alpha1",
        "kind": "TracingPolicy",
        "metadata": { "name": name },
    });
    let spec = match policy.kind.as_str() {
        "deny_process" => json!({
            "kprobes": [{
                "call": "security_bprm_check",
                "syscall": "execve",
                "args": [{"index": 0, "type": "string"}],
                "selectors": [{
                    "matchBinaries": [{"operator": "In", "values": [policy.match_value.clone()]}],
                    "matchActions": [{"action": "Sigkill"}],
                }],
            }],
        }),
        "deny_dns" => json!({
            "kprobes": [{
                "call": "dns",
                "selectors": [{
                    "matchArgs": [{
                        "index": 0,
                        "operator": "Prefix",
                        "values": [policy.match_value.replace("*.", "")],
                    }],
                    "matchActions": [{"action": "Post"}],
                }],
            }],
        }),
        "deny_port" => {
            let (port, proto) = policy
                .match_value
                .split_once('/')
                .map(|(p, pr)| (p.to_string(), pr.to_string()))
                .unwrap_or((policy.match_value.clone(), "tcp".into()));
            json!({
                "kprobes": [{
                    "call": "tcp_connect",
                    "selectors": [{
                        "matchArgs": [{"index": 2, "operator": "Equal", "values": [port]}],
                        "matchActions": [{"action": "Sigkill"}],
                    }],
                }],
                "protocol": proto,
            })
        }
        "deny_file" => json!({
            "kprobes": [{
                "call": "security_file_open",
                "syscall": "open",
                "args": [{"index": 0, "type": "string"}],
                "selectors": [{
                    "matchArgs": [{
                        "index": 0,
                        "operator": "Prefix",
                        "values": [policy.match_value.trim_end_matches('*')],
                    }],
                    "matchActions": [{"action": "Post"}, {"action": "Sigkill"}],
                }],
            }],
        }),
        "deny_cap" => json!({
            "kprobes": [{
                "call": "cap_capable",
                "selectors": [{
                    "matchCapabilities": [{
                        "type": "Effective",
                        "operator": "In",
                        "values": [policy.match_value.clone()],
                    }],
                    "matchActions": [{"action": "Sigkill"}],
                }],
            }],
        }),
        _ => json!({
            "kprobes": [{
                "call": "tcp_connect",
                "selectors": [{
                    "matchArgs": [{"index": 1, "operator": "Equal", "values": [policy.match_value.clone()]}],
                    "matchActions": [{"action": "Sigkill"}],
                }],
            }],
        }),
    };
    base["spec"] = spec;
    base
}

pub fn ack_agent_bundle(host_id: &str) -> Value {
    let removed = LOCAL_FABRIC
        .write()
        .ok()
        .and_then(|mut state| state.pending_tetragon.remove(host_id))
        .is_some();
    json!({
        "ok": true,
        "host_id": host_id,
        "acknowledged": removed,
        "source": "machina-controller",
    })
}

pub fn fabric_health(
    cfg: &ControllerConfig,
    packetwolf_reachable: bool,
    production_network_api: bool,
) -> Value {
    let sensors = list_sensors();
    let healthy = sensors
        .iter()
        .filter(|s| {
            matches!(
                s.get("status").and_then(|v| v.as_str()),
                Some("healthy") | Some("registered")
            )
        })
        .count();
    let mut issues = Vec::new();
    if sensors.is_empty() {
        issues.push(json!({
            "severity": "info",
            "kind": "no_sensors",
            "summary": "No Tetragon sensors enrolled — install sensors on hosts or K8s clusters",
        }));
    }
    if production_network_api {
        issues.push(json!({
            "severity": "info",
            "kind": "production_network_api",
            "summary": "Production PacketWolf network API connected — anomalies, threats, and flows live; Tetragon enrollment via Machina controller",
        }));
    } else {
        issues.push(json!({
            "severity": "info",
            "kind": "fabric_api_fallback",
            "summary": "Production PacketWolf lacks dev fabric routes — sensor registry handled by Machina controller",
        }));
    }
    let status = if packetwolf_reachable {
        if sensors.is_empty() && !production_network_api {
            "degraded"
        } else {
            "healthy"
        }
    } else {
        "offline"
    };
    let summary = if production_network_api {
        format!(
            "{} sensor(s) · PacketWolf {} · production network API + Machina Tetragon fabric",
            sensors.len(),
            if packetwolf_reachable {
                "reachable"
            } else {
                "unreachable"
            }
        )
    } else {
        format!(
            "{} sensor(s) · PacketWolf {} · Machina local fabric fallback",
            sensors.len(),
            if packetwolf_reachable {
                "reachable"
            } else {
                "unreachable"
            }
        )
    };
    json!({
        "status": status,
        "sensors_total": sensors.len(),
        "sensors_healthy": healthy,
        "issues": issues,
        "summary": summary,
        "packetwolf_base_url": cfg.packetwolf_base_url,
        "api_mode": if production_network_api { "production_network" } else { "local_fabric" },
        "source": "machina-controller",
    })
}

pub fn sensors_response() -> Value {
    json!({
        "sensors": list_sensors(),
        "source": "machina-controller",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_register_and_bundle_roundtrip() {
        let host = "e5caecb1-f1c0-48c4-8721-276eecb1f747";
        let reg = register_sensor(host, "1.0.0");
        assert_eq!(reg.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(list_sensors().len(), 1);

        let export = "https://127.0.0.1:9443/api/v1/ingest";
        let queued = queue_tetragon_install(host, export);
        assert_eq!(queued.get("ok").and_then(|v| v.as_bool()), Some(true));

        let bundle = agent_bundle(host);
        assert!(bundle.get("tetragon_install").is_some());
        assert_eq!(
            bundle
                .pointer("/tetragon_install/export_url")
                .and_then(|v| v.as_str()),
            Some(export)
        );

        let ack = ack_agent_bundle(host);
        assert_eq!(
            ack.get("acknowledged").and_then(|v| v.as_bool()),
            Some(true)
        );
        let bundle_after = agent_bundle(host);
        assert!(bundle_after.get("tetragon_install").unwrap().is_null());
    }
}
