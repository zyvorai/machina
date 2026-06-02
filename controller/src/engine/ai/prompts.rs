// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct PromptRow {
    pub id: Uuid,
    pub scope: String,
    pub owner_id: String,
    pub team_id: String,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub agent_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePromptBody {
    pub scope: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub team_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PatchPromptBody {
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
    pub agent_id: Option<String>,
}

pub async fn list_prompts(pool: &PgPool, user_id: &str) -> anyhow::Result<Vec<PromptRow>> {
    let rows: Vec<(Uuid, String, String, String, String, String, serde_json::Value, String, DateTime<Utc>)> =
        sqlx::query_as(
            "SELECT id, scope, owner_id, team_id, title, body, tags, agent_id, created_at
             FROM ai_prompts
             WHERE scope = 'org' OR owner_id = $1 OR (scope = 'team' AND team_id <> '')
             ORDER BY created_at DESC LIMIT 200",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(map_row).collect())
}

fn map_row(
    (id, scope, owner_id, team_id, title, body, tags, agent_id, created_at): (
        Uuid,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        String,
        DateTime<Utc>,
    ),
) -> PromptRow {
    PromptRow {
        id,
        scope,
        owner_id,
        team_id,
        title,
        body,
        tags: serde_json::from_value(tags).unwrap_or_default(),
        agent_id,
        created_at,
    }
}

pub async fn create_prompt(
    pool: &PgPool,
    user_id: &str,
    body: &CreatePromptBody,
) -> anyhow::Result<PromptRow> {
    let scope = if body.scope.trim().is_empty() {
        "personal"
    } else {
        body.scope.trim()
    };
    let agent_id = if body.agent_id.trim().is_empty() {
        "auto"
    } else {
        body.agent_id.trim()
    };
    let tags = serde_json::to_value(&body.tags)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO ai_prompts (scope, owner_id, team_id, title, body, tags, agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(scope)
    .bind(user_id)
    .bind(body.team_id.trim())
    .bind(body.title.trim())
    .bind(body.body.trim())
    .bind(tags)
    .bind(agent_id)
    .fetch_one(pool)
    .await?;
    get_prompt(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("prompt missing"))
}

pub async fn get_prompt(pool: &PgPool, id: Uuid) -> anyhow::Result<Option<PromptRow>> {
    let row: Option<(Uuid, String, String, String, String, String, serde_json::Value, String, DateTime<Utc>)> =
        sqlx::query_as(
            "SELECT id, scope, owner_id, team_id, title, body, tags, agent_id, created_at FROM ai_prompts WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(map_row))
}

pub async fn patch_prompt(
    pool: &PgPool,
    id: Uuid,
    body: &PatchPromptBody,
) -> anyhow::Result<PromptRow> {
    if let Some(v) = &body.title {
        sqlx::query("UPDATE ai_prompts SET title = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(v) = &body.body {
        sqlx::query("UPDATE ai_prompts SET body = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(v) = &body.tags {
        sqlx::query("UPDATE ai_prompts SET tags = $1, updated_at = NOW() WHERE id = $2")
            .bind(serde_json::to_value(v)?)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(v) = &body.agent_id {
        sqlx::query("UPDATE ai_prompts SET agent_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(pool)
            .await?;
    }
    get_prompt(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("prompt not found"))
}

pub async fn delete_prompt(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let r = sqlx::query("DELETE FROM ai_prompts WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}
