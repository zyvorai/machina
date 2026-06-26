// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Extension;
use axum::Json;
use axum::extract::ConnectInfo;
use std::net::SocketAddr;
use serde::Deserialize;
use uuid::Uuid;

use crate::agent_client;
use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::engine::ai::security as ai_security;
use crate::engine::ai::security_graph;
use crate::engine::packetwolf_bridge;
use crate::engine::packetwolf_local;
use crate::engine::zeus_security;
use crate::state::AppState;

pub async fn status(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<zeus_security::ZeusSecurityStatus>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::status(&state.config).await))
}

pub async fn fleet_threat(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<zeus_security::FleetThreatSummary>, ApiError> {
    require_operator(&actor)?;
    zeus_security::fleet_threat(&state.pool, &state.config)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn sensors(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::sensors(&state.config).await))
}

pub async fn asset_inventory(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::asset_inventory(&state.config).await))
}

pub async fn fleet_timeline(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::fleet_timeline(&state.config, q.hours.unwrap_or(24)).await))
}

pub async fn sync_alerts(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let n = zeus_security::sync_security_alerts(&state.pool, &state.config)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(
        serde_json::json!({ "inserted": n, "summary": format!("Synced {n} security alert(s) to notification outbox") }),
    ))
}

pub async fn correlations(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::correlations(&state.config).await))
}

pub async fn security_graph(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<security_graph::SecurityGraph>, ApiError> {
    require_operator(&actor)?;
    security_graph::build_graph(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct HostQuery {
    pub hours: Option<u32>,
}

pub async fn host_summary(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_summary(&state.config, &id.to_string()).await))
}

pub async fn host_processes(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "processes", q.hours.unwrap_or(24)).await))
}

pub async fn host_connections(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(
        zeus_security::host_resource(&state.config, &id.to_string(), "connections", q.hours.unwrap_or(24))
            .await,
    ))
}

pub async fn host_dns(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "dns", q.hours.unwrap_or(24)).await))
}

pub async fn host_files(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "files", q.hours.unwrap_or(168)).await))
}

pub async fn host_ports(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "ports", 0).await))
}

pub async fn host_containers(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "containers", 0).await))
}

pub async fn host_timeline(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(zeus_security::host_resource(&state.config, &id.to_string(), "timeline", q.hours.unwrap_or(24)).await))
}

#[derive(Debug, Deserialize)]
pub struct ProcessGraphQuery {
    pub pid: Option<i64>,
}

pub async fn host_process_graph(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<ProcessGraphQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let pid_q = q.pid.map(|p| format!("?pid={p}")).unwrap_or_default();
    Ok(Json(packetwolf_bridge::host_fabric(&state.config, &id.to_string(), "process-graph", &pid_q).await))
}

#[derive(Debug, Deserialize)]
pub struct SearchBody {
    pub query: String,
    pub host_id: Option<String>,
}

pub async fn search(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<SearchBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::search(&state.config, &body.query, body.host_id.as_deref()).await))
}

pub async fn install_tetragon(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    use crate::tasks::enqueue::enqueue_task;

    let id_str = id.to_string();
    let pw = packetwolf_bridge::register_sensor(&state.config, &id_str).await;
    let _ = packetwolf_bridge::queue_tetragon_install(&state.config, &id_str).await;
    let task_id = enqueue_task(
        &state,
        "host.tetragon.install",
        serde_json::json!({ "host_id": id_str, "packetwolf_base_url": state.config.packetwolf_base_url }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await?;
    Ok(Json(serde_json::json!({
        "task_id": task_id.to_string(),
        "packetwolf": pw,
        "summary": "Tetragon sensor enrollment queued"
    })))
}

#[derive(Debug, Deserialize)]
pub struct K8sTetragonBody {
    pub cluster_name: Option<String>,
}

pub async fn install_k8s_tetragon(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(cluster_id): Path<String>,
    Json(body): Json<K8sTetragonBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    use crate::tasks::enqueue::enqueue_task;

    let cluster = body.cluster_name.unwrap_or_else(|| cluster_id.clone());
    let task_id = enqueue_task(
        &state,
        "k8s.tetragon.install",
        serde_json::json!({
            "cluster_id": cluster_id,
            "cluster_name": cluster,
            "helm_release": "tetragon",
            "namespace": "kube-system",
        }),
        Some("k8s"),
        None,
        None,
    )
    .await?;
    Ok(Json(serde_json::json!({
        "task_id": task_id.to_string(),
        "cluster_id": cluster_id,
        "summary": format!("Tetragon Helm install + PacketWolf export forwarder queued for cluster {cluster}")
    })))
}

#[derive(Debug, Deserialize)]
pub struct K8sExportQuery {
    pub namespace: Option<String>,
}

pub async fn k8s_export_status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(cluster_id): Path<String>,
    Query(q): Query<K8sExportQuery>,
) -> Result<Json<crate::engine::packetwolf_k8s::K8sExportForwarderStatus>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(crate::engine::packetwolf_k8s::export_forwarder_status(
        &state.config,
        &cluster_id,
        q.namespace.as_deref().unwrap_or("kube-system"),
    )))
}

pub async fn fabric_health(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::fabric_health(&state.config).await))
}

pub async fn hunt_queries(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::hunt_queries(&state.config).await))
}

pub async fn run_hunt_query(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(query_id): Path<String>,
    Query(q): Query<HuntRunQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::run_hunt_query(&state.config, &query_id, q.host_id.as_deref()).await))
}

#[derive(Debug, Deserialize)]
pub struct HuntRunQuery {
    pub host_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExplainEventBody {
    pub event: serde_json::Value,
    pub host_id: Option<String>,
}

pub async fn explain_event(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ExplainEventBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    ai_security::explain_event(&state.pool, &body.event, body.host_id.as_deref())
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct AttackReconstructBody {
    pub host_id: String,
    pub hours: Option<u32>,
}

pub async fn attack_reconstruct(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<AttackReconstructBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let timeline = zeus_security::host_resource(
        &state.config,
        &body.host_id,
        "timeline",
        body.hours.unwrap_or(24),
    )
    .await;
    ai_security::attack_reconstruct(&state.pool, &timeline)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct NlSearchBody {
    pub query: String,
    pub host_id: Option<String>,
}

pub async fn nl_search(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<NlSearchBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let (translated, llm_powered) =
        ai_security::translate_nl_search_async(&state.pool, &body.query).await;
    let results =
        packetwolf_bridge::search(&state.config, &translated, body.host_id.as_deref()).await;
    let hits = results
        .get("hit_count")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            results
                .get("results")
                .and_then(|v| v.as_array())
                .map(|a| a.len() as u64)
        })
        .unwrap_or(0);
    let backend = results
        .get("backend")
        .and_then(|v| v.as_str())
        .unwrap_or("memory");
    Ok(Json(serde_json::json!({
        "original_query": body.query,
        "search_query": translated,
        "results": results,
        "hit_count": hits,
        "search_backend": backend,
        "llm_powered": llm_powered
    })))
}

#[derive(Debug, Deserialize)]
pub struct HuntSummaryBody {
    pub hours: Option<u32>,
}

pub async fn hunt_summary(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<HuntSummaryBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let hours = body.hours.unwrap_or(48);
    let timeline = zeus_security::fleet_timeline(&state.config, hours).await;
    let correlations = packetwolf_bridge::correlations(&state.config).await;
    ai_security::hunt_summary(&state.pool, &correlations, &timeline)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn enforcement_status(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::enforcement_status(&state.config).await))
}

pub async fn enforcement_policies(State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::enforcement_policies(&state.config).await))
}

#[derive(Debug, Deserialize)]
pub struct CreateEnforcementPolicyBody {
    pub name: String,
    pub kind: String,
    pub r#match: String,
    pub enabled: Option<bool>,
    pub scope: Option<String>,
    pub host_ids: Option<Vec<String>>,
    pub description: Option<String>,
}

pub async fn create_enforcement_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateEnforcementPolicyBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let payload = serde_json::json!({
        "name": body.name,
        "kind": body.kind,
        "match": body.r#match,
        "enabled": body.enabled.unwrap_or(true),
        "scope": body.scope.unwrap_or_else(|| "fleet".into()),
        "host_ids": body.host_ids.unwrap_or_default(),
        "description": body.description.unwrap_or_default(),
    });
    Ok(Json(packetwolf_bridge::create_enforcement_policy(&state.config, payload).await))
}

#[derive(Debug, Deserialize)]
pub struct ApplyEnforcementBody {
    pub host_ids: Vec<String>,
}

async fn enqueue_enforcement_bundle_sync(
    state: &AppState,
    host_ids: &[String],
    policy_id: &str,
) -> Result<Vec<String>, ApiError> {
    use crate::tasks::enqueue::enqueue_task;
    use uuid::Uuid;

    let mut task_ids = Vec::new();
    for host_id in host_ids {
        let host_uuid = Uuid::parse_str(host_id).ok();
        let task_id = enqueue_task(
            state,
            "host.enforcement.apply",
            serde_json::json!({
                "host_id": host_id,
                "policy_id": policy_id,
            }),
            Some("host"),
            host_uuid,
            host_uuid,
        )
        .await?;
        task_ids.push(task_id.to_string());
    }
    Ok(task_ids)
}

pub async fn apply_enforcement_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(policy_id): Path<String>,
    Json(body): Json<ApplyEnforcementBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let pw = packetwolf_bridge::apply_enforcement_policy(&state.config, &policy_id, &body.host_ids)
        .await;
    let task_ids = enqueue_enforcement_bundle_sync(&state, &body.host_ids, &policy_id).await?;
    Ok(Json(serde_json::json!({
        "packetwolf": pw,
        "task_ids": task_ids,
        "summary": format!("Enforcement policy {policy_id} queued for {} host(s)", body.host_ids.len())
    })))
}

#[derive(Debug, Deserialize)]
pub struct PatchEnforcementPolicyBody {
    pub enabled: Option<bool>,
    pub r#match: Option<String>,
    pub description: Option<String>,
}

pub async fn patch_enforcement_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(policy_id): Path<String>,
    Json(body): Json<PatchEnforcementPolicyBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let payload = serde_json::json!({
        "enabled": body.enabled,
        "match": body.r#match,
        "description": body.description,
    });
    let pw = packetwolf_bridge::patch_enforcement_policy(&state.config, &policy_id, payload).await;
    let sync_hosts: Vec<String> = pw
        .get("sync_hosts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|h| h.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let task_ids = if sync_hosts.is_empty() {
        vec![]
    } else {
        enqueue_enforcement_bundle_sync(&state, &sync_hosts, &policy_id).await?
    };
    Ok(Json(serde_json::json!({
        "packetwolf": pw,
        "task_ids": task_ids,
        "summary": format!("Enforcement policy {policy_id} updated")
    })))
}

pub async fn delete_enforcement_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(policy_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let pw = packetwolf_bridge::delete_enforcement_policy(&state.config, &policy_id).await;
    let sync_hosts: Vec<String> = pw
        .get("removed_from_hosts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|h| h.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let task_ids = if sync_hosts.is_empty() {
        vec![]
    } else {
        enqueue_enforcement_bundle_sync(&state, &sync_hosts, &policy_id).await?
    };
    Ok(Json(serde_json::json!({
        "packetwolf": pw,
        "task_ids": task_ids,
        "summary": format!("Enforcement policy {policy_id} deleted")
    })))
}

pub async fn enforcement_policy_tetragon(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(policy_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::enforcement_policy_tetragon(&state.config, &policy_id).await))
}

pub async fn attach_enforcement(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    Ok(Json(
        crate::engine::packetwolf_enforcement::attach_enforcement(&state.config).await,
    ))
}

pub async fn sync_enforcement(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    Ok(Json(
        crate::engine::packetwolf_enforcement::sync_enforcement(&state.config).await,
    ))
}

pub async fn detach_enforcement(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    Ok(Json(
        crate::engine::packetwolf_enforcement::detach_enforcement(&state.config).await,
    ))
}

pub async fn install_fleet_tetragon(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    use crate::tasks::enqueue::enqueue_task;

    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT id FROM hosts WHERE state = 'online' ORDER BY hostname")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut task_ids = Vec::new();
    for (host_uuid,) in &rows {
        let id = host_uuid.to_string();
        let _ = packetwolf_bridge::register_sensor(&state.config, &id).await;
        let _ = packetwolf_bridge::queue_tetragon_install(&state.config, &id).await;
        let task_id = enqueue_task(
            &state,
            "host.tetragon.install",
            serde_json::json!({
                "host_id": id,
                "packetwolf_base_url": state.config.packetwolf_base_url,
            }),
            Some("host"),
            Some(*host_uuid),
            Some(*host_uuid),
        )
        .await?;
        task_ids.push(task_id.to_string());
    }
    Ok(Json(serde_json::json!({
        "task_ids": task_ids,
        "hosts": rows.len(),
        "summary": format!("Tetragon enrollment queued for {} online host(s)", rows.len())
    })))
}

pub async fn fleet_sensors(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let pw = packetwolf_bridge::sensors(&state.config).await;
    let sensors = pw
        .get("sensors")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let hosts: Vec<(Uuid, String, String)> =
        sqlx::query_as("SELECT id, hostname, state FROM hosts ORDER BY hostname")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let sensor_by_host: std::collections::HashMap<String, serde_json::Value> = sensors
        .iter()
        .filter_map(|s| {
            let hid = s.get("host_id")?.as_str()?;
            Some((hid.to_string(), s.clone()))
        })
        .collect();
    let matrix: Vec<serde_json::Value> = hosts
        .iter()
        .map(|(id, hostname, host_state)| {
            let id_str = id.to_string();
            let sensor = sensor_by_host.get(&id_str).or_else(|| sensor_by_host.get(hostname));
            serde_json::json!({
                "host_id": id_str,
                "hostname": hostname,
                "host_state": host_state,
                "sensor": sensor,
                "tetragon_status": sensor.and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("missing"),
                "last_event_at": sensor.and_then(|s| s.get("last_event_at")),
            })
        })
        .collect();
    Ok(Json(serde_json::json!({
        "sensors": sensors,
        "matrix": matrix,
        "summary": format!("{} host(s) · {} PacketWolf sensor(s)", hosts.len(), sensors.len())
    })))
}

pub async fn host_enforcement(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::host_enforcement(&state.config, &id).await))
}

pub async fn agent_security_bundle(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(packetwolf_bridge::agent_bundle(&state.config, &id).await))
}

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct IngestEventsBody {
    pub events: Vec<serde_json::Value>,
}

pub async fn ingest_tetragon_events(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<IngestEventsBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let local_ingest = crate::engine::packetwolf_ingest::ingest_authorized(
        &headers,
        Some(&addr.to_string()),
    );
    if !local_ingest {
        require_admin(&actor)?;
    }
    let count = body.events.len();
    if count == 0 {
        return Ok(Json(serde_json::json!({ "ingested": 0, "host_id": id })));
    }

    packetwolf_local::record_events(&id, count);
    let _ = crate::engine::packetwolf_local_db::touch_sensor_events(&state.pool, &id, count).await;

    let relay = crate::engine::packetwolf_ingest::relay_tetragon_batch(
        &state.config,
        &id,
        &serde_json::json!({ "events": body.events }),
    )
    .await;

    Ok(Json(serde_json::json!({
        "ingested": count,
        "host_id": id,
        "source": "machina-controller",
        "sensor_status": "healthy",
        "relay": relay,
    })))
}

pub async fn host_fabric_status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let host_uuid = Uuid::parse_str(&id).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let agent_addr: Option<String> =
        sqlx::query_scalar("SELECT agent_grpc_addr FROM hosts WHERE id = ?")
            .bind(host_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let Some(addr) = agent_addr.filter(|a| !a.is_empty()) else {
        return Ok(Json(serde_json::json!({
            "host_id": id,
            "agent_reachable": false,
            "message": "host not found or agent address missing",
        })));
    };
    match agent_client::get_security_fabric_status(&addr).await {
        Ok(fabric) => Ok(Json(serde_json::json!({
            "host_id": id,
            "agent_reachable": true,
            "fabric": fabric,
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "host_id": id,
            "agent_reachable": false,
            "message": e.to_string(),
        }))),
    }
}
