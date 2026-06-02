// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::collections::HashSet;

use reqwest::Client;
use serde::Deserialize;
use uuid::Uuid;

use crate::engine::vm_inventory::{cluster_inventory_policy, ClusterInventoryPolicy};
use crate::state::AppState;

const KUBEVIRT_MISSING: &str = "kubevirt_not_found: VirtualMachine no longer present in cluster inventory scan";

#[derive(Debug, Deserialize)]
struct KubeVirtInventoryResponse {
    #[serde(default)]
    rows: Vec<KubeVirtVmRow>,
    #[serde(default = "default_true")]
    kubevirt_available: bool,
    #[serde(default)]
    list_error: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct KubeVirtVmRow {
    name: String,
    namespace: String,
    #[serde(default)]
    vmi_phase: Option<String>,
    #[serde(default)]
    vm_printable_status: Option<String>,
    #[serde(default)]
    guest_ip: Option<String>,
    #[serde(default)]
    pod_ip: Option<String>,
}

fn observed_from_row(row: &KubeVirtVmRow) -> String {
    let phase = row
        .vmi_phase
        .as_deref()
        .or(row.vm_printable_status.as_deref())
        .unwrap_or("unknown");
    match phase {
        "Running" | "running" | "Ready" | "ready" => "running".into(),
        "Stopped" | "stopped" | "Halted" | "halted" => "stopped".into(),
        "Pending" | "pending" | "Scheduling" | "scheduling" => "pending".into(),
        "Failed" | "failed" | "Error" | "error" => "failed".into(),
        other if other.eq_ignore_ascii_case("running") => "running".into(),
        other if other.eq_ignore_ascii_case("stopped") => "stopped".into(),
        _ => "unknown".into(),
    }
}

pub async fn fetch_inventory_rows(
    daemon_base_url: &str,
) -> anyhow::Result<KubeVirtInventoryResponse> {
    let url = format!(
        "{}/api/v1/k8s/kubevirt/vm-summary?all_namespaces=true&meta=1",
        daemon_base_url.trim_end_matches('/')
    );
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()?;
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("daemon kubevirt inventory HTTP {status}: {body}");
    }
    Ok(resp.json().await?)
}

pub async fn sync_cluster(state: &AppState, cluster_id: Uuid) -> anyhow::Result<()> {
    let summary = match fetch_inventory_rows(&state.config.daemon_base_url).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("kubevirt inventory fetch failed (keeping DB rows): {e:#}");
            return Ok(());
        }
    };

    if !summary.kubevirt_available {
        tracing::debug!(
            list_error = ?summary.list_error,
            "kubevirt CRD unavailable — skip prune"
        );
        return Ok(());
    }

    if summary.list_error.is_some() && summary.rows.is_empty() {
        tracing::warn!(
            err = ?summary.list_error,
            "kubevirt list error with empty rows — skip prune"
        );
        return Ok(());
    }

    let policy = cluster_inventory_policy(&state.pool, cluster_id).await?;
    let mut seen: HashSet<(String, String)> = HashSet::new();

    for row in &summary.rows {
        let ns = row.namespace.clone();
        let name = row.name.clone();
        seen.insert((ns.clone(), name.clone()));
        let observed = observed_from_row(row);
        let spec = serde_json::json!({
            "kubevirt": true,
            "namespace": ns,
            "guest_ip": row.guest_ip,
            "pod_ip": row.pod_ip,
        });

        let existing: Option<(Uuid, bool)> = sqlx::query_as(
            "SELECT id, managed FROM vms
             WHERE cluster_id = $1 AND inventory_source = 'kubevirt'
               AND k8s_namespace = $2 AND name = $3",
        )
        .bind(cluster_id)
        .bind(&ns)
        .bind(&name)
        .fetch_optional(&state.pool)
        .await?;

        if let Some((id, _managed)) = existing {
            sqlx::query(
                "UPDATE vms SET observed_state = $1, spec_json = $2, last_seen_at = NOW(), updated_at = NOW()
                 WHERE id = $3",
            )
            .bind(&observed)
            .bind(&spec)
            .bind(id)
            .execute(&state.pool)
            .await?;
        } else {
            let new_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO vms (id, cluster_id, host_id, name, k8s_namespace, spec_json,
                 desired_state, observed_state, managed, lifecycle_phase, inventory_source, last_seen_at)
                 VALUES ($1, $2, NULL, $3, $4, $5, 'unknown', $6, FALSE, 'idle', 'kubevirt', NOW())",
            )
            .bind(new_id)
            .bind(cluster_id)
            .bind(&name)
            .bind(&ns)
            .bind(&spec)
            .bind(&observed)
            .execute(&state.pool)
            .await?;
            state.emit_event(
                "vm.discovered",
                format!("Discovered KubeVirt VM '{}/{}' in cluster", ns, name),
            );
        }
    }

    reconcile_kubevirt_tombstones(state, cluster_id, &seen, &policy).await
}

async fn reconcile_kubevirt_tombstones(
    state: &AppState,
    cluster_id: Uuid,
    seen: &HashSet<(String, String)>,
    policy: &ClusterInventoryPolicy,
) -> anyhow::Result<()> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: Uuid,
        name: String,
        k8s_namespace: Option<String>,
        managed: bool,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, name, k8s_namespace, managed FROM vms
         WHERE cluster_id = $1 AND inventory_source = 'kubevirt'",
    )
    .bind(cluster_id)
    .fetch_all(&state.pool)
    .await?;

    for row in rows {
        let ns = row.k8s_namespace.unwrap_or_else(|| "default".into());
        if seen.contains(&(ns.clone(), row.name.clone())) {
            continue;
        }
        if !row.managed && policy.inventory_prune_unmanaged {
            sqlx::query("DELETE FROM vms WHERE id = $1")
                .bind(row.id)
                .execute(&state.pool)
                .await?;
            state.emit_event(
                "vm.removed",
                format!("Discovered KubeVirt VM '{}/{}' removed from inventory", ns, row.name),
            );
        } else if row.managed && policy.inventory_mark_managed_missing {
            sqlx::query(
                "UPDATE vms SET observed_state = 'missing', last_error = $1, updated_at = NOW() WHERE id = $2",
            )
            .bind(KUBEVIRT_MISSING)
            .bind(row.id)
            .execute(&state.pool)
            .await?;
            state.emit_event(
                "vm.missing",
                format!("KubeVirt VM '{}/{}' missing from cluster", ns, row.name),
            );
        }
    }
    Ok(())
}

/// Delete a KubeVirt VM via the co-located daemon (kubectl delete).
pub async fn delete_kubevirt_vm(
    daemon_base_url: &str,
    namespace: &str,
    name: &str,
) -> anyhow::Result<()> {
    let url = format!(
        "{}/api/v1/k8s/kubevirt/virtualmachines/{}/{}",
        daemon_base_url.trim_end_matches('/'),
        urlencoding::encode(namespace),
        urlencoding::encode(name)
    );
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let resp = client.delete(&url).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("daemon kubevirt delete HTTP {status}: {body}");
    }
    Ok(())
}
