// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Reverse-proxy selected HyperSDK / hypervisord APIs for bulk OpenStack migrations.

use axum::{
    extract::{Path, Query},
    routing::{get, post},
    Json, Router,
};
use machina_core::{HypersdkConfig, LibvirtError, LibvirtManager, MachinaConfig};
use serde::Deserialize;
use serde_json::Value;

use crate::error::AppError;

fn hypersdk_cfg() -> HypersdkConfig {
    MachinaConfig::load().hypersdk
}

fn client(cfg: &HypersdkConfig) -> Result<reqwest::Client, AppError> {
    let mut b = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120));
    if cfg.insecure_tls {
        b = b.danger_accept_invalid_certs(true);
    }
    b.build()
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("hypersdk http client: {e}"))))
}

fn base_url(cfg: &HypersdkConfig) -> Result<String, AppError> {
    if !cfg.enabled {
        return Err(AppError::from(LibvirtError::Forbidden(
            "hypersdk.enabled is false in machina config".into(),
        )));
    }
    let u = cfg.base_url.trim().trim_end_matches('/');
    if u.is_empty() {
        return Err(AppError::from(LibvirtError::Invalid(
            "hypersdk.base_url is empty".into(),
        )));
    }
    Ok(u.to_string())
}

async fn proxy_get(
    cfg: &HypersdkConfig,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Value, AppError> {
    let client = client(cfg)?;
    let url = format!("{}{}", base_url(cfg)?, path);
    let resp = client.get(&url).query(query).send().await.map_err(|e| {
        AppError::from(LibvirtError::Operation(format!("hypersdk GET {path}: {e}")))
    })?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({ "raw": "non-json response" }));
    if !status.is_success() {
        return Err(AppError::from(LibvirtError::Operation(format!(
            "hypersdk GET {path} HTTP {status}: {body}"
        ))));
    }
    Ok(body)
}

async fn proxy_post(cfg: &HypersdkConfig, path: &str, body: Value) -> Result<Value, AppError> {
    let client = client(cfg)?;
    let url = format!("{}{}", base_url(cfg)?, path);
    let resp = client.post(&url).json(&body).send().await.map_err(|e| {
        AppError::from(LibvirtError::Operation(format!(
            "hypersdk POST {path}: {e}"
        )))
    })?;
    let status = resp.status();
    let out: Value = resp
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({ "raw": "non-json response" }));
    if !status.is_success() {
        return Err(AppError::from(LibvirtError::Operation(format!(
            "hypersdk POST {path} HTTP {status}: {out}"
        ))));
    }
    Ok(out)
}

async fn hypersdk_status() -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    let mut out = serde_json::json!({
        "enabled": cfg.enabled,
        "base_url": cfg.base_url,
        "insecure_tls": cfg.insecure_tls,
        "reachable": false,
    });
    if !cfg.enabled {
        return Ok(Json(out));
    }
    match proxy_get(&cfg, "/api/v1/system/health", &[]).await {
        Ok(_) => {
            out["reachable"] = true.into();
        }
        Err(_) => {
            out["last_error"] = "hypervisord health check failed".into();
        }
    }
    Ok(Json(out))
}

async fn hypersdk_providers_list() -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    Ok(Json(proxy_get(&cfg, "/api/providers/list", &[]).await?))
}

#[derive(Debug, Deserialize)]
struct ProviderVmsQuery {
    pub provider: String,
}

async fn hypersdk_provider_vms(Query(q): Query<ProviderVmsQuery>) -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    let provider = q.provider.trim();
    Ok(Json(
        proxy_get(&cfg, "/api/providers/vms", &[("provider", provider)]).await?,
    ))
}

async fn hypersdk_list_migration_jobs() -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    Ok(Json(proxy_get(&cfg, "/api/v1/migrations/jobs", &[]).await?))
}

async fn hypersdk_get_migration_job(Path(id): Path<String>) -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    let id = id.trim();
    Ok(Json(
        proxy_get(&cfg, &format!("/api/v1/migrations/jobs/{id}"), &[]).await?,
    ))
}

async fn hypersdk_submit_migration(Json(body): Json<Value>) -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    Ok(Json(
        proxy_post(&cfg, "/api/v1/migrations/submit", body).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct HypersdkProxyQuery {
    pub path: String,
}

fn validate_proxy_path(path: &str) -> Result<&str, AppError> {
    let p = path.trim();
    if !p.starts_with("/api/") {
        return Err(AppError::from(LibvirtError::Invalid(
            "proxy path must start with /api/".into(),
        )));
    }
    if p.contains("..") {
        return Err(AppError::from(LibvirtError::Invalid(
            "invalid proxy path".into(),
        )));
    }
    Ok(p)
}

async fn hypersdk_proxy_get(Query(q): Query<HypersdkProxyQuery>) -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    let path = validate_proxy_path(&q.path)?;
    Ok(Json(proxy_get(&cfg, path, &[]).await?))
}

async fn hypersdk_proxy_post(
    Query(q): Query<HypersdkProxyQuery>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let cfg = hypersdk_cfg();
    let path = validate_proxy_path(&q.path)?;
    Ok(Json(proxy_post(&cfg, path, body).await?))
}

pub fn hypersdk_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/hypersdk/status", get(hypersdk_status))
        .route("/hypersdk/providers/list", get(hypersdk_providers_list))
        .route("/hypersdk/providers/vms", get(hypersdk_provider_vms))
        .route(
            "/hypersdk/migrations/jobs",
            get(hypersdk_list_migration_jobs),
        )
        .route(
            "/hypersdk/migrations/jobs/{id}",
            get(hypersdk_get_migration_job),
        )
        .route(
            "/hypersdk/migrations/submit",
            post(hypersdk_submit_migration),
        )
        .route(
            "/hypersdk/proxy",
            get(hypersdk_proxy_get).post(hypersdk_proxy_post),
        )
}
