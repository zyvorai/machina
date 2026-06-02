// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySettings {
    pub enabled: bool,
    pub team_scope: bool,
    pub project_scope: bool,
    pub retention_days: i32,
}

pub async fn get_settings(pool: &PgPool) -> anyhow::Result<MemorySettings> {
    let row: (bool, bool, bool, i32) = sqlx::query_as(
        "SELECT COALESCE(zeus_memory_enabled, TRUE), COALESCE(zeus_memory_team_scope, FALSE),
                COALESCE(zeus_memory_project_scope, TRUE), COALESCE(zeus_memory_retention_days, 90)
         FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await?;
    Ok(MemorySettings {
        enabled: row.0,
        team_scope: row.1,
        project_scope: row.2,
        retention_days: row.3,
    })
}

#[derive(Debug, Deserialize)]
pub struct MemorySettingsPatch {
    pub enabled: Option<bool>,
    pub team_scope: Option<bool>,
    pub project_scope: Option<bool>,
    pub retention_days: Option<i32>,
}

pub async fn patch_settings(pool: &PgPool, patch: &MemorySettingsPatch) -> anyhow::Result<MemorySettings> {
    if let Some(v) = patch.enabled {
        sqlx::query("UPDATE clusters SET zeus_memory_enabled = $1")
            .bind(v)
            .execute(pool)
            .await?;
    }
    if let Some(v) = patch.team_scope {
        sqlx::query("UPDATE clusters SET zeus_memory_team_scope = $1")
            .bind(v)
            .execute(pool)
            .await?;
    }
    if let Some(v) = patch.project_scope {
        sqlx::query("UPDATE clusters SET zeus_memory_project_scope = $1")
            .bind(v)
            .execute(pool)
            .await?;
    }
    if let Some(v) = patch.retention_days {
        sqlx::query("UPDATE clusters SET zeus_memory_retention_days = $1")
            .bind(v.clamp(1, 3650))
            .execute(pool)
            .await?;
    }
    get_settings(pool).await
}

pub async fn recall_for_user(
    pool: &PgPool,
    user_id: Option<&str>,
    limit: i64,
) -> anyhow::Result<Vec<String>> {
    let settings = get_settings(pool).await?;
    if !settings.enabled {
        return Ok(vec![]);
    }
    let cap = limit.clamp(1, 20);
    let uid = user_id.unwrap_or("");
    let rows: Vec<String> = if uid.is_empty() {
        sqlx::query_scalar(
            "SELECT summary FROM ai_memory_entries
             WHERE expires_at IS NULL OR expires_at > NOW()
             ORDER BY created_at DESC LIMIT $1",
        )
        .bind(cap)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT summary FROM ai_memory_entries
             WHERE owner_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC LIMIT $2",
        )
        .bind(uid)
        .bind(cap)
        .fetch_all(pool)
        .await?
    };
    Ok(rows)
}

pub async fn remember(
    pool: &PgPool,
    owner_id: &str,
    subject_kind: &str,
    subject_id: &str,
    summary: &str,
    project_id: Option<&str>,
) -> anyhow::Result<Uuid> {
    let settings = get_settings(pool).await?;
    if !settings.enabled {
        return Ok(Uuid::nil());
    }
    let retention = settings.retention_days.max(1) as i64;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO ai_memory_entries (scope, owner_id, project_id, subject_kind, subject_id, summary, expires_at)
         VALUES ('user', $1, $2, $3, $4, $5, NOW() + ($6 || ' days')::interval)
         RETURNING id",
    )
    .bind(owner_id)
    .bind(project_id.unwrap_or(""))
    .bind(subject_kind)
    .bind(subject_id)
    .bind(summary)
    .bind(retention.to_string())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn purge(pool: &PgPool, scope: &str, owner_id: Option<&str>) -> anyhow::Result<u64> {
    let deleted = if scope == "all" {
        sqlx::query("DELETE FROM ai_memory_entries")
            .execute(pool)
            .await?
            .rows_affected()
    } else if let Some(uid) = owner_id {
        sqlx::query("DELETE FROM ai_memory_entries WHERE owner_id = $1")
            .bind(uid)
            .execute(pool)
            .await?
            .rows_affected()
    } else {
        0
    };
    Ok(deleted)
}

#[derive(Debug, Serialize)]
pub struct ConversationRow {
    pub id: Uuid,
    pub agent_id: String,
    pub summary: String,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_conversations(pool: &PgPool, user_id: &str) -> anyhow::Result<Vec<ConversationRow>> {
    let rows: Vec<(Uuid, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, agent_id, summary, updated_at FROM ai_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, agent_id, summary, updated_at)| ConversationRow {
            id,
            agent_id,
            summary,
            updated_at,
        })
        .collect())
}

pub async fn upsert_conversation_summary(
    pool: &PgPool,
    user_id: &str,
    agent_id: &str,
    summary: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO ai_conversations (user_id, agent_id, summary, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(agent_id)
    .bind(summary)
    .execute(pool)
    .await?;
    Ok(())
}
