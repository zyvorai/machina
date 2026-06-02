// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize)]
pub struct AgentPluginRow {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub agent_id: String,
    pub installed: bool,
}

pub async fn list_agents(pool: &PgPool) -> anyhow::Result<Vec<AgentPluginRow>> {
    let rows: Vec<(String, String, String, String, bool)> = sqlx::query_as(
        "SELECT slug, name, description, agent_id, installed FROM ai_agent_plugins ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(slug, name, description, agent_id, installed)| AgentPluginRow {
            slug,
            name,
            description,
            agent_id,
            installed,
        })
        .collect())
}

pub async fn install(pool: &PgPool, slug: &str) -> anyhow::Result<AgentPluginRow> {
    sqlx::query("UPDATE ai_agent_plugins SET installed = TRUE WHERE slug = $1")
        .bind(slug)
        .execute(pool)
        .await?;
    get(pool, slug)
        .await?
        .ok_or_else(|| anyhow::anyhow!("agent plugin not found"))
}

pub async fn uninstall(pool: &PgPool, slug: &str) -> anyhow::Result<AgentPluginRow> {
    sqlx::query("UPDATE ai_agent_plugins SET installed = FALSE WHERE slug = $1")
        .bind(slug)
        .execute(pool)
        .await?;
    get(pool, slug)
        .await?
        .ok_or_else(|| anyhow::anyhow!("agent plugin not found"))
}

async fn get(pool: &PgPool, slug: &str) -> anyhow::Result<Option<AgentPluginRow>> {
    let row: Option<(String, String, String, String, bool)> = sqlx::query_as(
        "SELECT slug, name, description, agent_id, installed FROM ai_agent_plugins WHERE slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(slug, name, description, agent_id, installed)| AgentPluginRow {
        slug,
        name,
        description,
        agent_id,
        installed,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PublishAgentBody {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub agent_id: String,
}

pub async fn publish(pool: &PgPool, body: &PublishAgentBody) -> anyhow::Result<AgentPluginRow> {
    sqlx::query(
        "INSERT INTO ai_agent_plugins (slug, name, description, agent_id, installed)
         VALUES ($1, $2, $3, $4, FALSE)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, agent_id = EXCLUDED.agent_id",
    )
    .bind(body.slug.trim())
    .bind(body.name.trim())
    .bind(body.description.trim())
    .bind(body.agent_id.trim())
    .execute(pool)
    .await?;
    get(pool, &body.slug)
        .await?
        .ok_or_else(|| anyhow::anyhow!("publish failed"))
}
