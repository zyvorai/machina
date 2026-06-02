// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::PgPool;

use super::providers::ResolvedProvider;
use super::routing::{RoutingRequest, TaskClass};

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub task_class: TaskClass,
    pub system: String,
    pub user: String,
    pub agent_id: Option<String>,
    pub user_id: Option<String>,
}

/// Optional LLM completion — returns None when disabled or on failure.
pub async fn complete(pool: &PgPool, req: CompletionRequest) -> anyhow::Result<Option<String>> {
    if !super::settings::llm_enabled(pool).await? {
        return Ok(None);
    }
    let routing = RoutingRequest {
        task_class: req.task_class,
        agent_id: req.agent_id.clone(),
        user_id: req.user_id.clone(),
    };
    let Some(resolved) = super::routing::resolve(pool, &routing).await? else {
        return Ok(None);
    };
    complete_resolved(&resolved, &req.system, &req.user).await
}

/// Backward-compatible helper for existing call sites.
pub async fn complete_simple(
    pool: &PgPool,
    system: &str,
    user: &str,
) -> anyhow::Result<Option<String>> {
    complete(
        pool,
        CompletionRequest {
            task_class: TaskClass::Infrastructure,
            system: system.to_string(),
            user: user.to_string(),
            agent_id: None,
            user_id: None,
        },
    )
    .await
}

pub async fn probe_provider(resolved: &ResolvedProvider) -> anyhow::Result<bool> {
    let text = complete_resolved(
        resolved,
        "You are a connectivity probe.",
        "Reply with OK only.",
    )
    .await?;
    Ok(text.is_some())
}

async fn complete_resolved(
    resolved: &ResolvedProvider,
    system: &str,
    user: &str,
) -> anyhow::Result<Option<String>> {
    if resolved.api_key.is_empty() && !uses_local_endpoint(&resolved.kind) {
        return Ok(None);
    }
    match resolved.kind.as_str() {
        "anthropic" => anthropic_complete(resolved, system, user).await,
        "google" | "gemini" => google_complete(resolved, system, user).await,
        _ => openai_compatible_complete(resolved, system, user).await,
    }
}

fn uses_local_endpoint(kind: &str) -> bool {
    matches!(kind, "ollama" | "vllm" | "openai_compatible")
}

fn openai_base(resolved: &ResolvedProvider) -> String {
    if !resolved.base_url.trim().is_empty() {
        let base = resolved.base_url.trim().trim_end_matches('/');
        if base.ends_with("/v1") {
            return format!("{base}/chat/completions");
        }
        return format!("{base}/v1/chat/completions");
    }
    match resolved.kind.as_str() {
        "azure_openai" => format!(
            "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
            resolved.base_url.trim().trim_end_matches('/'),
            resolved.deployment_name
        ),
        "xai" => "https://api.x.ai/v1/chat/completions".into(),
        "deepseek" => "https://api.deepseek.com/v1/chat/completions".into(),
        "mistral" => "https://api.mistral.ai/v1/chat/completions".into(),
        "ollama" => "http://127.0.0.1:11434/v1/chat/completions".into(),
        "vllm" => format!(
            "{}/v1/chat/completions",
            resolved.base_url.trim().trim_end_matches('/')
        ),
        _ => "https://api.openai.com/v1/chat/completions".into(),
    }
}

async fn openai_compatible_complete(
    resolved: &ResolvedProvider,
    system: &str,
    user: &str,
) -> anyhow::Result<Option<String>> {
    let model = if resolved.kind == "azure_openai" && !resolved.deployment_name.is_empty() {
        resolved.deployment_name.clone()
    } else {
        resolved.model_id.clone()
    };
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "max_tokens": 1024
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()?;
    let url = openai_base(resolved);
    let mut req = client.post(&url).json(&body);
    if !resolved.api_key.is_empty() {
        req = req.bearer_auth(&resolved.api_key);
    }
    if !resolved.org_id.is_empty() {
        req = req.header("OpenAI-Organization", &resolved.org_id);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        tracing::warn!("llm error ({}): {}", resolved.kind, resp.text().await.unwrap_or_default());
        return Ok(None);
    }
    let v: serde_json::Value = resp.json().await?;
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from);
    Ok(text)
}

async fn anthropic_complete(
    resolved: &ResolvedProvider,
    system: &str,
    user: &str,
) -> anyhow::Result<Option<String>> {
    let url = if resolved.base_url.trim().is_empty() {
        "https://api.anthropic.com/v1/messages".to_string()
    } else {
        format!("{}/v1/messages", resolved.base_url.trim().trim_end_matches('/'))
    };
    let body = serde_json::json!({
        "model": resolved.model_id,
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": "user", "content": user}]
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()?;
    let resp = client
        .post(url)
        .header("x-api-key", &resolved.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        tracing::warn!("anthropic error: {}", resp.text().await.unwrap_or_default());
        return Ok(None);
    }
    let v: serde_json::Value = resp.json().await?;
    let text = v["content"][0]["text"].as_str().map(String::from);
    Ok(text)
}

async fn google_complete(
    resolved: &ResolvedProvider,
    system: &str,
    user: &str,
) -> anyhow::Result<Option<String>> {
    let model = resolved.model_id.clone();
    let url = if resolved.base_url.trim().is_empty() {
        format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, resolved.api_key
        )
    } else {
        format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            resolved.base_url.trim().trim_end_matches('/'),
            model,
            resolved.api_key
        )
    };
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": format!("{system}\n\n{user}")}]}]
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()?;
    let resp = client.post(url).json(&body).send().await?;
    if !resp.status().is_success() {
        tracing::warn!("google error: {}", resp.text().await.unwrap_or_default());
        return Ok(None);
    }
    let v: serde_json::Value = resp.json().await?;
    let text = v["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(String::from);
    Ok(text)
}
