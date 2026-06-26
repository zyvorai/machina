// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! `GET /api/v1/vms/{name}/guacamole-auth` — encrypted JSON auth blob for Apache Guacamole (optional).

use axum::extract::{Extension, Path, State};
use axum::routing::get;
use axum::{Json, Router};
use libvirt_guac_bridge::{bridge_from_vnc_tcp, GuacamoleBridgeParams};
use machina_core::libvirt::vnc;
use machina_core::{LibvirtError, LibvirtManager, MachinaConfig};

use crate::auth::{require_browser_session_for_host_insight, RequestActor};
use crate::error::AppError;

async fn guacamole_auth_handler(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
) -> Result<Json<libvirt_guac_bridge::BridgeResponse>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let cfg = MachinaConfig::load();
    if !cfg.guacamole.enabled {
        return Err(AppError::from(LibvirtError::Invalid(
            "Guacamole integration is disabled ([guacamole] enabled = false)".into(),
        )));
    }

    let secret = cfg.guacamole.json_secret_hex.trim().to_string();
    if secret.is_empty() {
        return Err(AppError::from(LibvirtError::Invalid(
            "Set [guacamole] json_secret_hex to match Guacamole JSON_SECRET_KEY".into(),
        )));
    }

    let base = cfg.guacamole.base_url.trim().to_string();

    let name2 = name.clone();
    let manager2 = manager.clone();
    let vnc_ep = tokio::task::spawn_blocking(move || {
        manager2.with_conn(|conn| vnc::resolve_vnc_tcp(conn, &name2))
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;

    let public = cfg.guacamole.public_vnc_host.trim().to_string();
    let public_opt = if public.is_empty() {
        None
    } else {
        Some(public.as_str())
    };

    let username_storage = cfg.guacamole.json_username.trim().to_string();
    let username_ref: &str = if username_storage.is_empty() {
        "machina"
    } else {
        username_storage.as_str()
    };

    let params = GuacamoleBridgeParams {
        secret_hex: &secret,
        base_url: &base,
        public_vnc_host: public_opt,
        fetch_token: cfg.guacamole.fetch_token,
        username: username_ref,
    };

    let resp = bridge_from_vnc_tcp(name.clone(), vnc_ep.0, vnc_ep.1, &params)
        .await
        .map_err(|e| AppError::from(LibvirtError::Invalid(e.to_string())))?;

    Ok(Json(resp))
}

pub fn guacamole_routes() -> Router<LibvirtManager> {
    Router::new().route("/vms/{name}/guacamole-auth", get(guacamole_auth_handler))
}
