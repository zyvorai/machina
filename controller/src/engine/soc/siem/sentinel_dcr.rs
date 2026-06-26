// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde_json::json;
use sqlx::SqlitePool;

use super::{
    fetch_unexported_events, integration_err, integration_ok, mark_exported, EventRow,
    IntegrationRow,
};

pub async fn forward(
    pool: &SqlitePool,
    integ: &IntegrationRow,
    controller_id: &str,
) -> anyhow::Result<usize> {
    let dce = integ
        .config_json
        .get("dce_endpoint")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_end_matches('/');
    let stream = integ
        .config_json
        .get("stream_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Custom-MachinaSoc");
    if dce.is_empty() {
        return Ok(0);
    }

    let token = sentinel_token(&integ.config_json).await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let events = fetch_unexported_events(pool, integ.id, 100).await?;
    if events.is_empty() {
        return Ok(0);
    }

    let payload: Vec<_> = events
        .iter()
        .map(|ev| sentinel_record(ev, controller_id, stream))
        .collect();

    let url = format!(
        "{dce}/dataCollectionRules/{}/streams/{}?api-version=2023-01-01",
        integ
            .config_json
            .get("dcr_immutable_id")
            .and_then(|v| v.as_str())
            .unwrap_or("machina-soc"),
        stream
    );

    let res = client
        .post(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        integration_err(pool, integ.id, &format!("sentinel: {text}")).await?;
        anyhow::bail!("sentinel upload failed");
    }

    let ids: Vec<_> = events.iter().map(|e| e.id).collect();
    mark_exported(pool, integ.id, "event", &ids).await?;
    integration_ok(pool, integ.id).await?;
    Ok(ids.len())
}

fn sentinel_record(ev: &EventRow, host: &str, stream: &str) -> serde_json::Value {
    json!({
        "TimeGenerated": ev.occurred_at.to_rfc3339(),
        "Computer": host,
        "StreamName": stream,
        "RawData": ev.ecs_json,
        "Message": ev.summary,
        "Severity": ev.severity,
        "Source": ev.source,
    })
}

async fn sentinel_token(config: &serde_json::Value) -> anyhow::Result<String> {
    if let Some(t) = config.get("bearer_token").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    let tenant = config
        .get("tenant_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let client_id = config
        .get("client_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let secret = config
        .get("client_secret")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if tenant.is_empty() || client_id.is_empty() || secret.is_empty() {
        anyhow::bail!("sentinel: configure bearer_token or tenant_id/client_id/client_secret");
    }
    let url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .form(&[
            ("client_id", client_id),
            ("client_secret", secret),
            ("scope", "https://monitor.azure.com/.default"),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("no access_token in Azure response"))
}

pub async fn test_connection(config: &serde_json::Value) -> anyhow::Result<String> {
    let _ = sentinel_token(config).await?;
    Ok("Microsoft Sentinel credentials validated".into())
}
