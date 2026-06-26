// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use machina_core::{
    apply_k8s_plan, compile_k8s_policies, detect_k8s_backend, k8s_cluster_ready,
    FirewallPlanRequest,
};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct K8sFirewallStatus {
    pub ready: bool,
    pub backend: String,
    pub cluster_reachable: bool,
}

pub fn status() -> K8sFirewallStatus {
    let backend = detect_k8s_backend();
    K8sFirewallStatus {
        ready: k8s_cluster_ready(),
        backend: backend.as_str().into(),
        cluster_reachable: k8s_cluster_ready(),
    }
}

pub async fn compile_plan(
    namespace: &str,
    profile: &str,
) -> anyhow::Result<Vec<machina_core::K8sPolicyManifest>> {
    Ok(compile_k8s_policies(namespace, profile)?)
}

pub async fn apply_plan(
    pool: &SqlitePool,
    namespace: &str,
    profile: &str,
    actor: &str,
    dry_run: bool,
) -> anyhow::Result<machina_core::FirewallPlanResult> {
    let req = FirewallPlanRequest {
        profile: Some(profile.into()),
        enable: Some(true),
        stealth_level: None,
        preset: None,
        dry_run,
    };
    let result = apply_k8s_plan(namespace, &req)?;
    if !dry_run {
        let _ = sqlx::query(
            "INSERT INTO firewall_k8s_apply_log (id, namespace, profile, backend, actor, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(namespace)
        .bind(profile)
        .bind(detect_k8s_backend().as_str())
        .bind(actor)
        .bind(serde_json::json!({ "operations": result.operations }))
        .execute(pool)
        .await;
    }
    Ok(result)
}
