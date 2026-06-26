// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Same-origin reverse proxy to machina-controller (:5093) for the web UI.

use axum::{
    body::Body,
    extract::{Path, Request},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use base64::Engine;
use machina_core::{LibvirtError, LibvirtManager};

use crate::error::AppError;

pub(crate) fn controller_base() -> String {
    std::env::var("MACHINA_PLATFORM_CONTROLLER_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:5093".into())
        .trim_end_matches('/')
        .to_string()
}

fn platform_service_basic_auth() -> Option<HeaderValue> {
    let creds = std::env::var("MACHINA_PLATFORM_AUTH")
        .ok()
        .filter(|s| !s.is_empty())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(creds.as_bytes());
    HeaderValue::from_str(&format!("Basic {encoded}")).ok()
}

fn forward_headers(src: &HeaderMap) -> HeaderMap {
    let mut h = HeaderMap::new();
    for name in ["content-type", "accept"] {
        if let Some(v) = src.get(name) {
            h.insert(name, v.clone());
        }
    }
    // When MACHINA_PLATFORM_AUTH is set, always use it — the browser's Bearer token
    // is a daemon JWT which the controller cannot verify (different JWT secret).
    // If MACHINA_PLATFORM_AUTH is not set, forward whatever the browser sent as a
    // fallback (allows shared-secret or API-key setups).
    if let Some(v) = platform_service_basic_auth() {
        h.insert(header::AUTHORIZATION, v);
    } else if let Some(v) = src.get(header::AUTHORIZATION) {
        h.insert(header::AUTHORIZATION, v.clone());
    }
    h
}

async fn platform_controller_proxy(
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Result<Response, AppError> {
    let base = controller_base();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let path = if rest.is_empty() {
        String::new()
    } else if rest.starts_with('/') {
        rest
    } else {
        format!("/{rest}")
    };
    let url = format!("{base}{path}{query}");

    let method = req.method().clone();
    let headers = forward_headers(req.headers());
    let body_bytes = axum::body::to_bytes(req.into_body(), 32 * 1024 * 1024)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("read body: {e}"))))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("http client: {e}"))))?;

    let mut rb = client.request(method, &url).headers(headers);
    if !body_bytes.is_empty() {
        rb = rb.body(body_bytes);
    }

    let resp = rb.send().await.map_err(|e| {
        AppError::from(LibvirtError::Operation(format!(
            "platform controller unreachable at {base}: {e}"
        )))
    })?;

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out_headers = HeaderMap::new();
    if let Some(ct) = resp.headers().get(header::CONTENT_TYPE) {
        out_headers.insert(header::CONTENT_TYPE, ct.clone());
    }
    let bytes = resp.bytes().await.map_err(|e| {
        AppError::from(LibvirtError::Internal(format!(
            "read controller response: {e}"
        )))
    })?;

    Ok(Response::builder()
        .status(status)
        .body(Body::from(bytes))
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("response build: {e}"))))?)
}

pub fn platform_controller_routes() -> Router<LibvirtManager> {
    Router::new().route(
        "/platform/controller/{*rest}",
        any(platform_controller_proxy),
    )
}
