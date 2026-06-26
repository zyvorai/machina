// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Glance image upload (qcow2 → Glance) via native Rust API.

use std::path::Path;
use std::time::Duration;

use osauth::services::IMAGE;
use reqwest::Body;
use serde::{Deserialize, Serialize};
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, effective_cloud_name, map_osauth_err};
use super::resources::{create_instance, CreateInstanceRequest};

fn non_empty_opt(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlanceUploadPreview {
    pub qcow2_path: String,
    pub file_size_bytes: u64,
    pub suggested_name: String,
    pub disk_format: String,
    pub container_format: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GlanceUploadRequest {
    pub qcow2_path: String,
    #[serde(default)]
    pub glance_name: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub boot_instance: Option<bool>,
    #[serde(default)]
    pub flavor: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub key_name: Option<String>,
    #[serde(default)]
    pub instance_name: Option<String>,
    #[serde(default)]
    pub availability_zone: Option<String>,
    #[serde(default)]
    pub security_groups: Option<Vec<String>>,
    #[serde(default)]
    pub wait_until_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlanceUploadResult {
    pub image_id: String,
    pub image_name: String,
    pub status: String,
    pub bytes_uploaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlancePullRequest {
    /// Destination path under an allowed disk-images directory (must end with .qcow2).
    pub dest_path: String,
    #[serde(default)]
    pub wait_for_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlancePullResult {
    pub image_id: String,
    pub image_name: String,
    pub dest_path: String,
    pub bytes_written: u64,
}

#[derive(Serialize)]
struct CreateImageBody<'a> {
    name: &'a str,
    disk_format: &'a str,
    container_format: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    visibility: Option<&'a str>,
}

#[derive(Deserialize)]
struct GlanceImageCreated {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
}

/// Stat qcow2 and suggest a Glance image name.
pub fn preview_qcow2_upload(qcow2_path: &str) -> Result<GlanceUploadPreview, LibvirtError> {
    let path = qcow2_path.trim();
    if path.is_empty() {
        return Err(LibvirtError::Invalid("qcow2_path is required".into()));
    }
    let meta = std::fs::metadata(path).map_err(|e| {
        LibvirtError::Invalid(format!("disk image not found or unreadable: {path}: {e}"))
    })?;
    if !meta.is_file() {
        return Err(LibvirtError::Invalid(format!("not a file: {path}")));
    }
    let suggested_name = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("machina-disk")
        .to_string();
    Ok(GlanceUploadPreview {
        qcow2_path: path.to_string(),
        file_size_bytes: meta.len(),
        suggested_name,
        disk_format: "qcow2".into(),
        container_format: "bare".into(),
    })
}

/// Upload qcow2 to Glance; optionally boot a Nova instance from the new image.
pub async fn upload_qcow2_to_glance(
    cfg: &OpenStackConfig,
    req: &GlanceUploadRequest,
) -> Result<GlanceUploadResult, LibvirtError> {
    if !cfg.upload_enabled {
        return Err(LibvirtError::Forbidden(
            "openstack.upload_enabled is false; set it true in machina config to upload images."
                .into(),
        ));
    }

    let preview = preview_qcow2_upload(&req.qcow2_path)?;
    let glance_name = req
        .glance_name
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&preview.suggested_name);

    let session = connect_session(cfg).await?;

    let visibility = req
        .visibility
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(Some("private"));

    let create_body = CreateImageBody {
        name: glance_name,
        disk_format: "qcow2",
        container_format: "bare",
        visibility,
    };

    let image: GlanceImageCreated = session
        .post(IMAGE, ["images"])
        .json(&create_body)
        .fetch()
        .await
        .map_err(map_osauth_err)?;

    let file = File::open(&preview.qcow2_path)
        .await
        .map_err(|e| LibvirtError::Operation(format!("open {}: {e}", preview.qcow2_path)))?;
    let bytes_uploaded = preview.file_size_bytes;

    let stream = ReaderStream::new(file);
    let body = Body::wrap_stream(stream);
    let upload_timeout = Duration::from_secs(cfg.upload_timeout_secs.max(60));

    session
        .put(IMAGE, ["images", image.id.as_str(), "file"])
        .header("Content-Type", "application/octet-stream")
        .header("x-openstack-image-size", bytes_uploaded.to_string())
        .body(body)
        .timeout(upload_timeout)
        .send()
        .await
        .map_err(map_osauth_err)?;

    let boot_instance = req.boot_instance.unwrap_or(cfg.default_boot_instance);
    let mut instance_id = None;
    let mut instance_name_out = None;

    if boot_instance {
        let flavor = req
            .flavor
            .clone()
            .or_else(|| non_empty_opt(&cfg.default_flavor))
            .ok_or_else(|| {
                LibvirtError::Invalid(
                    "boot_instance requires flavor (request or [openstack] default_flavor)".into(),
                )
            })?;
        let network = req
            .network
            .clone()
            .or_else(|| non_empty_opt(&cfg.default_network));
        let key_name = req
            .key_name
            .clone()
            .or_else(|| non_empty_opt(&cfg.default_key_name));
        let inst_name = req
            .instance_name
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{glance_name}-vm"));

        let wait_active = req
            .wait_until_active
            .unwrap_or(cfg.default_wait_until_active);
        let create_resp = create_instance(
            cfg,
            &CreateInstanceRequest {
                name: inst_name.clone(),
                flavor,
                image: Some(image.id.clone()),
                boot_volume_id: None,
                boot_volume_image: None,
                boot_volume_size_gb: None,
                network,
                networks: None,
                server_group: None,
                key_name,
                availability_zone: req.availability_zone.clone().filter(|s| !s.is_empty()),
                security_groups: req.security_groups.clone(),
                user_data: None,
                wait_until_active: wait_active,
            },
        )
        .await?;
        instance_id = Some(create_resp.id);
        instance_name_out = Some(create_resp.name);
    }

    Ok(GlanceUploadResult {
        image_id: image.id,
        image_name: if image.name.is_empty() {
            glance_name.to_string()
        } else {
            image.name
        },
        status: if image.status.is_empty() {
            "active".into()
        } else {
            image.status
        },
        bytes_uploaded,
        instance_id,
        instance_name: instance_name_out,
    })
}

/// Delete a Glance image by ID.
pub async fn delete_glance_image(
    cfg: &OpenStackConfig,
    image_id: &str,
) -> Result<(), LibvirtError> {
    let id = image_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("image_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(IMAGE, ["images", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

/// Resolved cloud name for upload UI (from config or clouds.yaml).
pub fn upload_cloud_hint(cfg: &OpenStackConfig) -> Option<String> {
    effective_cloud_name(cfg)
}
