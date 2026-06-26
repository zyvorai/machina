// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub enabled: bool,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub api_key_configured: bool,
    pub autopilot_interval_secs: i32,
    pub autopilot_max_actions: i32,
    pub fleet_peer_urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autopilot_last_run: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiSettingsPatch {
    pub enabled: Option<bool>,
    pub mode: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub autopilot_interval_secs: Option<i32>,
    pub autopilot_max_actions: Option<i32>,
    pub fleet_peer_urls: Option<Vec<String>>,
}

pub async fn get_ai_settings(pool: &SqlitePool) -> anyhow::Result<AiSettings> {
    let row: (
        bool,
        String,
        String,
        String,
        String,
        i32,
        Option<chrono::DateTime<chrono::Utc>>,
        i32,
        serde_json::Value,
    ) = sqlx::query_as(
        "SELECT ai_enabled, ai_mode, ai_provider, ai_model, COALESCE(ai_api_key, ''),
         ai_autopilot_interval_secs, ai_autopilot_last_run, ai_autopilot_max_actions,
         COALESCE(ai_fleet_peer_urls, '[]')
         FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await?;
    let fleet_peer_urls: Vec<String> = serde_json::from_value(row.8).unwrap_or_default();
    Ok(AiSettings {
        enabled: row.0,
        mode: row.1,
        provider: row.2,
        model: row.3,
        api_key_configured: !row.4.is_empty(),
        autopilot_interval_secs: row.5,
        autopilot_last_run: row.6.map(|t| t.to_rfc3339()),
        autopilot_max_actions: row.7.clamp(1, 10),
        fleet_peer_urls,
    })
}

pub async fn patch_ai_settings(
    pool: &SqlitePool,
    patch: &AiSettingsPatch,
) -> anyhow::Result<AiSettings> {
    let mut tx = pool.begin().await?;
    if let Some(v) = patch.enabled {
        sqlx::query("UPDATE clusters SET ai_enabled = ?")
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &patch.mode {
        sqlx::query("UPDATE clusters SET ai_mode = ?")
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &patch.provider {
        sqlx::query("UPDATE clusters SET ai_provider = ?")
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &patch.model {
        sqlx::query("UPDATE clusters SET ai_model = ?")
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &patch.api_key {
        sqlx::query("UPDATE clusters SET ai_api_key = ?")
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = patch.autopilot_interval_secs {
        sqlx::query("UPDATE clusters SET ai_autopilot_interval_secs = ?")
            .bind(v.clamp(0, 86400))
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = patch.autopilot_max_actions {
        sqlx::query("UPDATE clusters SET ai_autopilot_max_actions = ?")
            .bind(v.clamp(1, 10))
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &patch.fleet_peer_urls {
        let json = serde_json::to_value(v)?;
        sqlx::query("UPDATE clusters SET ai_fleet_peer_urls = ?")
            .bind(json)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    get_ai_settings(pool).await
}

pub async fn get_fleet_peer_urls(pool: &SqlitePool) -> anyhow::Result<Vec<String>> {
    Ok(get_ai_settings(pool).await?.fleet_peer_urls)
}

pub async fn autopilot_max_actions(pool: &SqlitePool) -> anyhow::Result<usize> {
    Ok(get_ai_settings(pool)
        .await?
        .autopilot_max_actions
        .clamp(1, 10) as usize)
}

pub async fn api_key(pool: &SqlitePool) -> anyhow::Result<Option<String>> {
    if std::env::var("MACHINA_AI_DISABLED").ok().as_deref() == Some("1") {
        return Ok(None);
    }
    if let Ok(k) = std::env::var("MACHINA_AI_API_KEY") {
        if !k.is_empty() {
            return Ok(Some(k));
        }
    }
    let key: String = sqlx::query_scalar(
        "SELECT COALESCE(ai_api_key, '') FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await?;
    if key.is_empty() {
        Ok(None)
    } else {
        Ok(Some(key))
    }
}

pub async fn llm_enabled(pool: &SqlitePool) -> anyhow::Result<bool> {
    let s = get_ai_settings(pool).await?;
    Ok(s.enabled && s.api_key_configured && api_key(pool).await?.is_some())
}
