// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize)]
pub struct ZeusEnterpriseOverview {
    pub zeus_admin_role: bool,
    pub zeus_execute_role: bool,
    pub zeus_read_role: bool,
    pub air_gap_llm: bool,
    pub audit_events_24h: i64,
    pub scim_enabled: bool,
    pub sso_configured: bool,
}

pub async fn overview(pool: &PgPool, username: &str) -> anyhow::Result<ZeusEnterpriseOverview> {
    let air_gap: bool = sqlx::query_scalar(
        "SELECT COALESCE(zeus_air_gap_llm, FALSE) FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    let audit_events_24h: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'zeus.%' AND created_at > NOW() - INTERVAL '24 hours'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    let is_admin = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE username = $1 AND role = 'admin'",
    )
    .bind(username)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        > 0;
    Ok(ZeusEnterpriseOverview {
        zeus_admin_role: is_admin,
        zeus_execute_role: is_admin,
        zeus_read_role: true,
        air_gap_llm: air_gap,
        audit_events_24h,
        scim_enabled: false,
        sso_configured: false,
    })
}

#[derive(Debug, Deserialize)]
pub struct ZeusEnterprisePatch {
    pub air_gap_llm: Option<bool>,
}

pub async fn patch(pool: &PgPool, patch: &ZeusEnterprisePatch) -> anyhow::Result<()> {
    if let Some(v) = patch.air_gap_llm {
        sqlx::query("UPDATE clusters SET zeus_air_gap_llm = $1")
            .bind(v)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub fn require_zeus_execute(actor: &crate::auth::AuthUser) -> Result<(), crate::api::ApiError> {
    crate::auth::require_operator(actor)
}

pub fn require_zeus_admin(actor: &crate::auth::AuthUser) -> Result<(), crate::api::ApiError> {
    crate::auth::require_admin(actor)
}

pub async fn audit_llm_call(
    pool: &PgPool,
    actor: &str,
    provider_kind: &str,
    model: &str,
    task_class: &str,
    agent_id: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO audit_logs (id, actor, action, resource_type, detail)
         VALUES (gen_random_uuid(), $1, 'zeus.llm.complete', 'zeus', $2)",
    )
    .bind(actor)
    .bind(serde_json::json!({
        "provider_kind": provider_kind,
        "model": model,
        "task_class": task_class,
        "agent_id": agent_id
    }))
    .execute(pool)
    .await?;
    Ok(())
}
