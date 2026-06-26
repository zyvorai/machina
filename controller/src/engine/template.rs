// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

pub fn parse_template_ref(template_ref: &str) -> (String, String) {
    if let Some((n, v)) = template_ref.split_once('@') {
        (n.to_string(), v.to_string())
    } else {
        (template_ref.to_string(), "1.0.0".into())
    }
}

pub async fn resolve_template_disk(pool: &SqlitePool, template_ref: &str) -> anyhow::Result<String> {
    let (name, version) = if let Some((n, v)) = template_ref.split_once('@') {
        (n.to_string(), Some(v.to_string()))
    } else {
        (template_ref.to_string(), None)
    };

    let disk: String = if let Some(ver) = version {
        sqlx::query_scalar("SELECT source_disk FROM templates WHERE name = ? AND version = ?")
            .bind(&name)
            .bind(&ver)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("template not found: {name}@{ver}"))?
    } else {
        sqlx::query_scalar(
            "SELECT source_disk FROM templates WHERE name = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&name)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("template not found: {name}"))?
    };
    Ok(disk)
}

pub async fn resolve_template_firewall_profile(
    pool: &SqlitePool,
    template_ref: &str,
) -> anyhow::Result<Option<String>> {
    let (name, version) = if let Some((n, v)) = template_ref.split_once('@') {
        (n.to_string(), Some(v.to_string()))
    } else {
        (template_ref.to_string(), None)
    };
    let profile: Option<String> = if let Some(ver) = version {
        sqlx::query_scalar(
            "SELECT firewall_profile FROM templates WHERE name = ? AND version = ?",
        )
        .bind(&name)
        .bind(&ver)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT firewall_profile FROM templates WHERE name = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&name)
        .fetch_optional(pool)
        .await?
    };
    Ok(profile)
}

pub async fn upsert_ha_policy(
    pool: &SqlitePool,
    vm_id: Uuid,
    enabled: bool,
    restart_attempts: i32,
    restart_priority: &str,
    fence_on_failure: bool,
    anti_affinity: bool,
) -> anyhow::Result<()> {
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM ha_policies WHERE vm_id = ?")
        .bind(vm_id)
        .fetch_optional(pool)
        .await?;

    if let Some(id) = existing {
        sqlx::query(
            "UPDATE ha_policies SET enabled = ?, restart_attempts = ?, restart_priority = ?,
             fence_on_failure = ?, anti_affinity = ? WHERE id = ?",
        )
        .bind(enabled)
        .bind(restart_attempts)
        .bind(restart_priority)
        .bind(fence_on_failure)
        .bind(anti_affinity)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO ha_policies (id, vm_id, enabled, restart_attempts, restart_priority, fence_on_failure, anti_affinity)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(vm_id)
        .bind(enabled)
        .bind(restart_attempts)
        .bind(restart_priority)
        .bind(fence_on_failure)
        .bind(anti_affinity)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_ha_policy(pool: &SqlitePool, vm_id: Uuid) -> anyhow::Result<Option<HaPolicyRow>> {
    Ok(sqlx::query_as(
        "SELECT enabled, restart_attempts, restart_priority, fence_on_failure, anti_affinity
         FROM ha_policies WHERE vm_id = ?",
    )
    .bind(vm_id)
    .fetch_optional(pool)
    .await?)
}

/// Replace `{{ key }}` / `{{key}}` placeholders (Jinja-style subset).
pub fn apply_template_vars(
    input: &str,
    vars: &std::collections::HashMap<String, String>,
) -> String {
    let mut out = input.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{ {k} }}}}"), v);
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct HaPolicyRow {
    pub enabled: bool,
    pub restart_attempts: i32,
    pub restart_priority: String,
    pub fence_on_failure: bool,
    pub anti_affinity: bool,
}
