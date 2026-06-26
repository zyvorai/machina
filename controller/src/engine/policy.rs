// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug)]
pub struct PolicyViolation {
    pub rule_name: String,
    pub message: String,
    pub remediation: String,
}

pub async fn evaluate_vm_create(
    pool: &SqlitePool,
    project: &str,
    tags: &[String],
    vcpus: i32,
    memory_mib: i64,
    storage_gib: i64,
    ha_enabled: bool,
) -> Result<(), PolicyViolation> {
    check_project_quota(pool, project, vcpus, memory_mib, storage_gib).await?;

    let rows: Vec<(String, Value)> =
        sqlx::query_as("SELECT name, rule_json FROM policy_rules WHERE enabled = TRUE")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    for (name, rule) in rows {
        if let Some(v) = check_rule(&name, &rule, tags, ha_enabled, vcpus) {
            return Err(v);
        }
    }
    Ok(())
}

async fn check_project_quota(
    pool: &SqlitePool,
    project: &str,
    vcpus: i32,
    memory_mib: i64,
    storage_gib: i64,
) -> Result<(), PolicyViolation> {
    let row: Option<(i32, i32, i64, i64, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT q.max_vms, q.max_vcpu, q.max_memory_mib, q.max_storage_gib,
                COALESCE((SELECT COUNT(*) FROM vms WHERE COALESCE(project, 'default') = ?), 0),
                COALESCE((SELECT SUM(vcpus) FROM vms WHERE COALESCE(project, 'default') = ?), 0),
                COALESCE((SELECT SUM(memory_mib) FROM vms WHERE COALESCE(project, 'default') = ?), 0),
                COALESCE((SELECT SUM(size_gib) FROM vm_disks d JOIN vms v ON v.id = d.vm_id WHERE COALESCE(v.project, 'default') = ?), 0)
         FROM project_quotas q WHERE q.project = ?",
    )
    .bind(project)
    .bind(project)
    .bind(project)
    .bind(project)
    .bind(project)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some((max_vms, max_vcpu, max_mem, max_storage, cur_vms, cur_vcpu, cur_mem, cur_storage)) =
        row
    else {
        return Ok(());
    };

    if max_vms > 0 && cur_vms + 1 > max_vms as i64 {
        return Err(PolicyViolation {
            rule_name: "project_quota".into(),
            message: format!("Project '{project}' VM count quota exceeded ({max_vms})"),
            remediation: "Increase max_vms in project quotas or delete unused VMs.".into(),
        });
    }
    if max_vcpu > 0 && cur_vcpu + i64::from(vcpus) > i64::from(max_vcpu) {
        return Err(PolicyViolation {
            rule_name: "project_quota".into(),
            message: format!("Project '{project}' vCPU quota exceeded ({max_vcpu})"),
            remediation: "Increase max_vcpu quota or reduce VM size.".into(),
        });
    }
    if max_mem > 0 && cur_mem + memory_mib > max_mem {
        return Err(PolicyViolation {
            rule_name: "project_quota".into(),
            message: format!("Project '{project}' memory quota exceeded ({max_mem} MiB)"),
            remediation: "Increase max_memory_mib quota or use smaller VMs.".into(),
        });
    }
    if max_storage > 0 && cur_storage + storage_gib > max_storage {
        return Err(PolicyViolation {
            rule_name: "project_quota".into(),
            message: format!("Project '{project}' storage quota exceeded ({max_storage} GiB)"),
            remediation: "Increase max_storage_gib quota or shrink disks.".into(),
        });
    }
    Ok(())
}

fn check_rule(
    name: &str,
    rule: &Value,
    tags: &[String],
    ha_enabled: bool,
    vcpus: i32,
) -> Option<PolicyViolation> {
    let when = rule.get("when")?;
    if let Some(tag) = when.get("tags_contains").and_then(|v| v.as_str()) {
        if !tags.iter().any(|t| t.contains(tag)) {
            return None;
        }
    }
    if let Some(req) = rule.get("require") {
        if req.get("ha_enabled").and_then(|v| v.as_bool()) == Some(true) && !ha_enabled {
            return Some(PolicyViolation {
                rule_name: name.into(),
                message: format!("Policy '{name}' requires HA to be enabled"),
                remediation: "Enable HA on the VM spec or remove the production tag.".into(),
            });
        }
        if let Some(max) = req.get("max_vcpu").and_then(|v| v.as_i64()) {
            if i64::from(vcpus) > max {
                return Some(PolicyViolation {
                    rule_name: name.into(),
                    message: format!("Policy '{name}' limits vCPU to {max}"),
                    remediation: "Reduce vCPU count or request a policy exception.".into(),
                });
            }
        }
    }
    None
}

pub async fn upsert_project_quota(
    pool: &SqlitePool,
    project: &str,
    max_vms: i32,
    max_vcpu: i32,
    max_memory_mib: i64,
    max_storage_gib: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO project_quotas (project, max_vms, max_vcpu, max_memory_mib, max_storage_gib, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (project) DO UPDATE SET
           max_vms = EXCLUDED.max_vms,
           max_vcpu = EXCLUDED.max_vcpu,
           max_memory_mib = EXCLUDED.max_memory_mib,
           max_storage_gib = EXCLUDED.max_storage_gib,
           updated_at = datetime('now')",
    )
    .bind(project)
    .bind(max_vms)
    .bind(max_vcpu)
    .bind(max_memory_mib)
    .bind(max_storage_gib)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_policy_rules(pool: &SqlitePool) -> anyhow::Result<Vec<(Uuid, String, bool, Value)>> {
    Ok(
        sqlx::query_as("SELECT id, name, enabled, rule_json FROM policy_rules ORDER BY name")
            .fetch_all(pool)
            .await?,
    )
}
