// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::crypto;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProviderRow {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub org_id: String,
    pub deployment_name: String,
    pub api_key_configured: bool,
    pub enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProviderBody {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub deployment_name: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub models: Vec<CreateModelBody>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchProviderBody {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub base_url: Option<String>,
    pub org_id: Option<String>,
    pub deployment_name: Option<String>,
    pub api_key: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModelRow {
    pub id: Uuid,
    pub provider_id: Uuid,
    pub model_id: String,
    pub display_name: String,
    pub context_window: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateModelBody {
    pub model_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default = "default_context_window")]
    pub context_window: i32,
}

fn default_context_window() -> i32 {
    128_000
}

fn row_from_db(
    id: Uuid,
    name: String,
    kind: String,
    base_url: String,
    org_id: String,
    deployment_name: String,
    api_key: String,
    enabled: bool,
    is_default: bool,
) -> AiProviderRow {
    AiProviderRow {
        id,
        name,
        kind,
        base_url,
        org_id,
        deployment_name,
        api_key_configured: !api_key.is_empty(),
        enabled,
        is_default,
    }
}

pub async fn list_providers(pool: &SqlitePool) -> anyhow::Result<Vec<AiProviderRow>> {
    let rows: Vec<(Uuid, String, String, String, String, String, String, bool, bool)> =
        sqlx::query_as(
            "SELECT id, name, kind, base_url, org_id, deployment_name, api_key_encrypted, enabled, is_default
             FROM ai_providers ORDER BY is_default DESC, name",
        )
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, kind, base_url, org_id, deployment_name, key, enabled, is_default)| {
                row_from_db(
                    id,
                    name,
                    kind,
                    base_url,
                    org_id,
                    deployment_name,
                    key,
                    enabled,
                    is_default,
                )
            },
        )
        .collect())
}

pub async fn get_provider(pool: &SqlitePool, id: Uuid) -> anyhow::Result<Option<AiProviderRow>> {
    let row: Option<(Uuid, String, String, String, String, String, String, bool, bool)> =
        sqlx::query_as(
            "SELECT id, name, kind, base_url, org_id, deployment_name, api_key_encrypted, enabled, is_default
             FROM ai_providers WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(
        |(id, name, kind, base_url, org_id, deployment_name, key, enabled, is_default)| {
            row_from_db(
                id,
                name,
                kind,
                base_url,
                org_id,
                deployment_name,
                key,
                enabled,
                is_default,
            )
        },
    ))
}

async fn clear_default(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query("UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_provider(
    pool: &SqlitePool,
    body: &CreateProviderBody,
) -> anyhow::Result<AiProviderRow> {
    let stored_key = crypto::store_api_key(body.api_key.trim())?;
    let mut tx = pool.begin().await?;
    if body.is_default {
        sqlx::query("UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE")
            .execute(&mut *tx)
            .await?;
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO ai_providers (id, name, kind, base_url, org_id, deployment_name, api_key_encrypted, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(body.name.trim())
    .bind(body.kind.trim())
    .bind(body.base_url.trim())
    .bind(body.org_id.trim())
    .bind(body.deployment_name.trim())
    .bind(stored_key)
    .bind(body.is_default)
    .fetch_one(&mut *tx)
    .await?;

    for m in &body.models {
        let display = if m.display_name.trim().is_empty() {
            m.model_id.clone()
        } else {
            m.display_name.clone()
        };
        sqlx::query(
            "INSERT INTO ai_models (id, provider_id, model_id, display_name, context_window)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider_id, model_id) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(m.model_id.trim())
        .bind(display)
        .bind(m.context_window)
        .execute(&mut *tx)
        .await?;
    }

    if body.models.is_empty() {
        sqlx::query(
            "INSERT INTO ai_models (id, provider_id, model_id, display_name)
             VALUES (?, ?, 'gpt-4o-mini', 'gpt-4o-mini') ON CONFLICT DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    get_provider(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("provider not found after insert"))
}

pub async fn patch_provider(
    pool: &SqlitePool,
    id: Uuid,
    body: &PatchProviderBody,
) -> anyhow::Result<AiProviderRow> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ai_providers WHERE id = ?)")
        .bind(id)
        .fetch_one(pool)
        .await?;
    if !exists {
        anyhow::bail!("provider not found");
    }
    let stored_key = if let Some(v) = &body.api_key {
        Some(crypto::store_api_key(v.trim())?)
    } else {
        None
    };
    let mut tx = pool.begin().await?;
    if body.is_default == Some(true) {
        sqlx::query("UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE")
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.name {
        sqlx::query("UPDATE ai_providers SET name = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.kind {
        sqlx::query("UPDATE ai_providers SET kind = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.base_url {
        sqlx::query("UPDATE ai_providers SET base_url = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.org_id {
        sqlx::query("UPDATE ai_providers SET org_id = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.deployment_name {
        sqlx::query("UPDATE ai_providers SET deployment_name = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(stored_key) = stored_key {
        sqlx::query("UPDATE ai_providers SET api_key_encrypted = ? WHERE id = ?")
            .bind(stored_key)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.enabled {
        sqlx::query("UPDATE ai_providers SET enabled = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.is_default {
        sqlx::query("UPDATE ai_providers SET is_default = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    get_provider(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("provider not found"))
}

pub async fn delete_provider(pool: &SqlitePool, id: Uuid) -> anyhow::Result<bool> {
    let r = sqlx::query("DELETE FROM ai_providers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_models(pool: &SqlitePool, provider_id: Uuid) -> anyhow::Result<Vec<AiModelRow>> {
    let rows: Vec<(Uuid, Uuid, String, String, i32, bool)> = sqlx::query_as(
        "SELECT id, provider_id, model_id, display_name, context_window, enabled
         FROM ai_models WHERE provider_id = ? ORDER BY display_name",
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, provider_id, model_id, display_name, context_window, enabled)| AiModelRow {
                id,
                provider_id,
                model_id,
                display_name,
                context_window,
                enabled,
            },
        )
        .collect())
}

pub struct ResolvedProvider {
    pub provider_id: Uuid,
    pub kind: String,
    pub base_url: String,
    pub org_id: String,
    pub deployment_name: String,
    pub api_key: String,
    pub model_id: String,
}

pub async fn resolve_default(pool: &SqlitePool) -> anyhow::Result<Option<ResolvedProvider>> {
    resolve_for_provider(pool, None, None).await
}

pub async fn resolve_for_provider(
    pool: &SqlitePool,
    provider_id: Option<Uuid>,
    model_id: Option<&str>,
) -> anyhow::Result<Option<ResolvedProvider>> {
    let row: Option<(Uuid, String, String, String, String, String)> = if let Some(pid) = provider_id
    {
        sqlx::query_as(
            "SELECT id, kind, base_url, org_id, deployment_name, api_key_encrypted
             FROM ai_providers WHERE id = ? AND enabled = TRUE",
        )
        .bind(pid)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, kind, base_url, org_id, deployment_name, api_key_encrypted
             FROM ai_providers WHERE is_default = TRUE AND enabled = TRUE
             ORDER BY created_at LIMIT 1",
        )
        .fetch_optional(pool)
        .await?
    };

    let Some((pid, kind, base_url, org_id, deployment_name, stored_key)) = row else {
        return legacy_resolve(pool).await;
    };
    if stored_key.is_empty() {
        return Ok(None);
    }
    let api_key = crypto::load_api_key(&stored_key)?;

    let model: String = if let Some(mid) = model_id.filter(|s| !s.is_empty()) {
        mid.to_string()
    } else {
        sqlx::query_scalar(
            "SELECT model_id FROM ai_models WHERE provider_id = ? AND enabled = TRUE ORDER BY display_name LIMIT 1",
        )
        .bind(pid)
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| "gpt-4o-mini".into())
    };

    Ok(Some(ResolvedProvider {
        provider_id: pid,
        kind,
        base_url,
        org_id,
        deployment_name,
        api_key,
        model_id: model,
    }))
}

async fn legacy_resolve(pool: &SqlitePool) -> anyhow::Result<Option<ResolvedProvider>> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT ai_provider, ai_model, COALESCE(ai_api_key, '') FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let Some((kind, model, key)) = row else {
        return Ok(None);
    };
    if key.is_empty() {
        return Ok(None);
    }
    let api_key = crypto::load_api_key(&key)?;
    Ok(Some(ResolvedProvider {
        provider_id: Uuid::nil(),
        kind,
        base_url: String::new(),
        org_id: String::new(),
        deployment_name: String::new(),
        api_key,
        model_id: model,
    }))
}

pub async fn resolve_local(pool: &SqlitePool) -> anyhow::Result<Option<ResolvedProvider>> {
    let row: Option<(Uuid, String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, kind, base_url, org_id, deployment_name, api_key_encrypted
         FROM ai_providers
         WHERE enabled = TRUE AND kind IN ('ollama', 'vllm', 'openai_compatible')
         ORDER BY is_default DESC, created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let Some((pid, kind, base_url, org_id, deployment_name, stored_key)) = row else {
        return Ok(None);
    };
    let api_key = if stored_key.is_empty() {
        String::new()
    } else {
        crypto::load_api_key(&stored_key)?
    };
    let model: String = sqlx::query_scalar(
        "SELECT model_id FROM ai_models WHERE provider_id = ? AND enabled = TRUE ORDER BY display_name LIMIT 1",
    )
    .bind(pid)
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "llama3".into());
    Ok(Some(ResolvedProvider {
        provider_id: pid,
        kind,
        base_url,
        org_id,
        deployment_name,
        api_key,
        model_id: model,
    }))
}

pub async fn test_provider(pool: &SqlitePool, id: Uuid) -> anyhow::Result<serde_json::Value> {
    let resolved = resolve_for_provider(pool, Some(id), None)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Provider not configured or disabled"))?;
    let ok = super::llm::probe_provider(&resolved).await?;
    Ok(serde_json::json!({
        "ok": ok,
        "provider_id": resolved.provider_id,
        "model": resolved.model_id,
        "kind": resolved.kind
    }))
}
