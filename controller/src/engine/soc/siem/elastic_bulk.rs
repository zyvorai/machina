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
    _controller_id: &str,
) -> anyhow::Result<usize> {
    let url = integ
        .config_json
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_end_matches('/');
    let api_key = integ
        .config_json
        .get("api_key")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let index = integ
        .config_json
        .get("index")
        .and_then(|v| v.as_str())
        .unwrap_or("logs-machina.soc");
    if url.is_empty() {
        return Ok(0);
    }

    let bulk_url = format!("{url}/{index}/_bulk");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .danger_accept_invalid_certs(true)
        .build()?;

    let events = fetch_unexported_events(pool, integ.id, 200).await?;
    if events.is_empty() {
        return Ok(0);
    }

    let mut body = String::new();
    let mut ids = Vec::new();
    for ev in &events {
        body.push_str(&format!(r#"{{"index":{{"_index":"{index}"}}}}"#));
        body.push('\n');
        body.push_str(&serde_json::to_string(&elastic_doc(ev))?);
        body.push('\n');
        ids.push(ev.id);
    }

    let mut req = client
        .post(&bulk_url)
        .header("Content-Type", "application/x-ndjson")
        .body(body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("ApiKey {api_key}"));
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        integration_err(pool, integ.id, &format!("elastic bulk: {text}")).await?;
        anyhow::bail!("elastic bulk failed");
    }
    mark_exported(pool, integ.id, "event", &ids).await?;
    integration_ok(pool, integ.id).await?;
    Ok(ids.len())
}

fn elastic_doc(ev: &EventRow) -> serde_json::Value {
    let mut doc = ev.ecs_json.clone();
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("message".into(), json!(ev.summary));
        obj.insert("@timestamp".into(), json!(ev.occurred_at.to_rfc3339()));
    }
    doc
}

pub async fn test_connection(config: &serde_json::Value) -> anyhow::Result<String> {
    let url = config.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        anyhow::bail!("url required");
    }
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let res = client
        .get(format!("{}/_cluster/health", url.trim_end_matches('/')))
        .send()
        .await?;
    if res.status().is_success() {
        Ok("Elasticsearch cluster reachable".into())
    } else {
        anyhow::bail!("cluster health: {}", res.status())
    }
}
