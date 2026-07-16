// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! OS catalog, install-media detection, and RHEL image URL (Cockpit-machines-style helpers).

use axum::extract::Json;
use axum::routing::{get, post};
use axum::Router;
use machina_core::{LibvirtError, LibvirtManager};
use serde::Deserialize;
use serde_json::json;
use std::process::Command;
use tracing::warn;

use crate::error::AppError;

#[derive(Debug, Deserialize)]
struct OsDetectBody {
    url: String,
}

#[derive(Debug, Deserialize)]
struct RhelUrlBody {
    access_token: String,
    #[serde(default = "default_rhel_ver")]
    rhel_version: String,
    #[serde(default = "default_arch")]
    arch: String,
}

fn default_rhel_ver() -> String {
    "9".to_string()
}

fn default_arch() -> String {
    "x86_64".to_string()
}

/// `osinfo-query os -f short-id,name,version` when available.
async fn os_list_handler() -> Result<Json<serde_json::Value>, AppError> {
    let join = tokio::task::spawn_blocking(|| {
        Command::new("osinfo-query")
            .args(["os", "-f", "short-id,name,version"])
            .output()
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(e.to_string())))?;

    // Degrade gracefully when osinfo-query can't even be spawned (libosinfo not
    // installed → io::ErrorKind::NotFound). Previously this mapped to a 500, which made
    // the Create VM page's OS dropdown fail to load. Return the same empty-list + hint
    // fallback used below for a non-zero exit, so the page still works.
    let out = match join {
        Ok(o) => o,
        Err(e) => {
            warn!("osinfo-query unavailable ({e}); returning empty OS list");
            let empty: Vec<serde_json::Value> = Vec::new();
            return Ok(Json(json!({
                "oses": empty,
                "hint": "Install libosinfo (`osinfo-db` / `libosinfo`) for a full OS list."
            })));
        }
    };
    if !out.status.success() {
        warn!(
            "osinfo-query failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let empty: Vec<serde_json::Value> = Vec::new();
        return Ok(Json(json!({
            "oses": empty,
            "hint": "Install libosinfo (`osinfo-db` / `libosinfo`) for a full OS list."
        })));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows: Vec<serde_json::Value> = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split('|').map(|c| c.trim()).collect();
        if cols.len() >= 3 {
            rows.push(json!({
                "short_id": cols[0],
                "name": cols[1],
                "version": cols[2],
            }));
        }
    }
    Ok(Json(json!({ "oses": rows })))
}

/// Run `osinfo-detect --type=tree <url>` (HTTP install tree).
async fn os_detect_handler(
    Json(body): Json<OsDetectBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let url = body.url.clone();
    let join = tokio::task::spawn_blocking(move || {
        Command::new("osinfo-detect")
            .args(["--type=tree", &url])
            .output()
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(e.to_string())))?;

    let out =
        join.map_err(|e| AppError::from(LibvirtError::Operation(format!("osinfo-detect: {e}"))))?;
    Ok(Json(json!({
        "exit_code": out.status.code(),
        "stdout": String::from_utf8_lossy(&out.stdout).trim(),
        "stderr": String::from_utf8_lossy(&out.stderr).trim(),
    })))
}

/// Resolve RHEL KVM guest image URL via Red Hat API ( bearer token ).
async fn rhel_image_url_handler(
    Json(body): Json<RhelUrlBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let api = format!(
        "https://api.access.redhat.com/management/v1/images/rhel/{}/{}/",
        body.rhel_version, body.arch
    );
    let join = tokio::task::spawn_blocking(move || {
        Command::new("curl")
            .args([
                "-sS",
                "-f",
                "-H",
                &format!("Authorization: Bearer {}", body.access_token),
                &api,
            ])
            .output()
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(e.to_string())))?;

    let out = join.map_err(|e| AppError::from(LibvirtError::Operation(format!("curl: {e}"))))?;
    if !out.status.success() {
        return Ok(Json(json!({
            "error": "curl_failed",
            "stderr": String::from_utf8_lossy(&out.stderr),
        })));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!({}));
    Ok(Json(json!({ "raw": v })))
}

pub fn guest_image_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/guest-images/os-list", get(os_list_handler))
        .route("/guest-images/os-detect", post(os_detect_handler))
        .route("/guest-images/rhel-url", post(rhel_image_url_handler))
}
