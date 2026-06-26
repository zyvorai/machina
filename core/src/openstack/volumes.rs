// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Cinder volume create, extend, snapshot, list snapshots, restore from snapshot.

use osauth::services::BLOCK_STORAGE;
use serde::Deserialize;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};
use super::compute::{connect_cloud, map_openstack_err};
use super::quotas::probe_cinder_reachable;
use super::resources::OpenStackAttachedVolume;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct OpenStackCreateVolumeRequest {
    pub size_gb: u64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub volume_type: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ExtendVolumeRequest {
    pub new_size_gb: u64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct SnapshotVolumeRequest {
    pub name: String,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackVolumeSnapshot {
    pub id: String,
    pub name: String,
    pub volume_id: String,
    pub size_gb: u64,
    pub status: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CreateVolumeFromSnapshotRequest {
    pub snapshot_id: String,
    pub name: Option<String>,
    /// Optional size (must be >= snapshot size).
    pub size_gb: Option<u64>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct RetypeVolumeRequest {
    pub new_type: String,
    #[serde(default = "default_migration_policy")]
    pub migration_policy: String,
}

fn default_migration_policy() -> String {
    "on-demand".into()
}

pub async fn create_cinder_volume(
    cfg: &OpenStackConfig,
    req: &OpenStackCreateVolumeRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    if req.size_gb == 0 {
        return Err(LibvirtError::Invalid("size_gb must be > 0".into()));
    }
    super::quotas::ensure_cinder_reachable(cfg).await?;
    let cloud = connect_cloud(cfg).await?;
    let mut builder = cloud.new_volume(req.size_gb);
    if let Some(ref name) = req.name {
        let n = name.trim();
        if !n.is_empty() {
            builder = builder.with_name(n.to_string());
        }
    }
    if let Some(ref desc) = req.description {
        let d = desc.trim();
        if !d.is_empty() {
            builder = builder.with_description(d);
        }
    }
    if let Some(ref vt) = req.volume_type {
        let t = vt.trim();
        if !t.is_empty() {
            builder = builder.with_volume_type(t);
        }
    }
    let vol = builder.create().await.map_err(map_openstack_err)?;
    Ok(OpenStackAttachedVolume {
        id: vol.id().clone(),
        name: vol.name().clone(),
        size_gb: vol.size(),
        device: String::new(),
        bootable: vol.bootable(),
        server_id: None,
    })
}

pub async fn delete_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
) -> Result<(), LibvirtError> {
    let id = volume_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("volume_id is required".into()));
    }
    let cloud = connect_cloud(cfg).await?;
    let vol = cloud.get_volume(id).await.map_err(map_openstack_err)?;
    vol.delete().await.map_err(map_openstack_err)?;
    Ok(())
}

pub async fn extend_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
    req: &ExtendVolumeRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    if req.new_size_gb == 0 {
        return Err(LibvirtError::Invalid("new_size_gb must be > 0".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "os-extend": { "new_size": req.new_size_gb } });
    session
        .post(BLOCK_STORAGE, &["volumes", volume_id.trim(), "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let cloud = connect_cloud(cfg).await?;
    let vol = cloud
        .get_volume(volume_id)
        .await
        .map_err(map_openstack_err)?;
    Ok(OpenStackAttachedVolume {
        id: vol.id().clone(),
        name: vol.name().clone(),
        size_gb: vol.size(),
        device: String::new(),
        bootable: vol.bootable(),
        server_id: None,
    })
}

pub async fn snapshot_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
    req: &SnapshotVolumeRequest,
) -> Result<serde_json::Value, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("snapshot name is required".into()));
    }
    let session = connect_session(cfg).await?;
    let force = req.force.unwrap_or(false);
    let body = serde_json::json!({
        "snapshot": {
            "name": name,
            "force": force,
            "volume_id": volume_id.trim()
        }
    });
    let resp = session
        .post(BLOCK_STORAGE, &["snapshots"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let val: serde_json::Value = resp.json().await.map_err(map_json_err)?;
    Ok(val)
}

pub async fn list_cinder_snapshots(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackVolumeSnapshot>, LibvirtError> {
    if !probe_cinder_reachable(cfg).await {
        return Ok(Vec::new());
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        snapshots: Vec<SnapJson>,
    }
    #[derive(Deserialize)]
    struct SnapJson {
        id: String,
        name: String,
        volume_id: String,
        size: u64,
        status: String,
    }
    let resp = session
        .get(BLOCK_STORAGE, &["snapshots", "detail"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .snapshots
        .into_iter()
        .map(|s| OpenStackVolumeSnapshot {
            id: s.id,
            name: s.name,
            volume_id: s.volume_id,
            size_gb: s.size,
            status: s.status,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_cinder_snapshot(
    cfg: &OpenStackConfig,
    snapshot_id: &str,
) -> Result<OpenStackVolumeSnapshot, LibvirtError> {
    let id = snapshot_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("snapshot id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        snapshot: SnapJson,
    }
    #[derive(Deserialize)]
    struct SnapJson {
        id: String,
        name: String,
        volume_id: String,
        size: u64,
        status: String,
    }
    let resp = session
        .get(BLOCK_STORAGE, &["snapshots", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackVolumeSnapshot {
        id: body.snapshot.id,
        name: body.snapshot.name,
        volume_id: body.snapshot.volume_id,
        size_gb: body.snapshot.size,
        status: body.snapshot.status,
    })
}

pub async fn get_volume_transfer(
    cfg: &OpenStackConfig,
    transfer_id: &str,
) -> Result<OpenStackVolumeTransfer, LibvirtError> {
    let id = transfer_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("transfer id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        transfer: TransferJson,
    }
    #[derive(Deserialize)]
    struct TransferJson {
        id: String,
        name: String,
        volume_id: String,
        #[serde(default)]
        auth_key: Option<String>,
    }
    let resp = session
        .get(BLOCK_STORAGE, &["os-volume-transfer", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackVolumeTransfer {
        id: body.transfer.id,
        name: body.transfer.name,
        volume_id: body.transfer.volume_id,
        auth_key: body.transfer.auth_key,
    })
}

pub async fn create_volume_from_snapshot(
    cfg: &OpenStackConfig,
    req: &CreateVolumeFromSnapshotRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let snap_id = req.snapshot_id.trim();
    if snap_id.is_empty() {
        return Err(LibvirtError::Invalid("snapshot_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut volume = serde_json::json!({ "snapshot_id": snap_id });
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            volume["name"] = serde_json::json!(t);
        }
    }
    if let Some(sz) = req.size_gb {
        if sz > 0 {
            volume["size"] = serde_json::json!(sz);
        }
    }
    let body = serde_json::json!({ "volume": volume });
    #[derive(Deserialize)]
    struct Resp {
        volume: VolJson,
    }
    #[derive(Deserialize)]
    struct VolJson {
        id: String,
        name: String,
        size: u64,
        #[serde(default)]
        bootable: bool,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["volumes"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackAttachedVolume {
        id: parsed.volume.id,
        name: parsed.volume.name,
        size_gb: parsed.volume.size,
        device: String::new(),
        bootable: parsed.volume.bootable,
        server_id: None,
    })
}

pub async fn retype_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
    req: &RetypeVolumeRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let new_type = req.new_type.trim();
    if new_type.is_empty() {
        return Err(LibvirtError::Invalid("new_type is required".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "os-retype": {
            "new_type": new_type,
            "migration_policy": req.migration_policy.trim()
        }
    });
    session
        .post(BLOCK_STORAGE, &["volumes", volume_id.trim(), "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let cloud = connect_cloud(cfg).await?;
    let vol = cloud
        .get_volume(volume_id)
        .await
        .map_err(map_openstack_err)?;
    Ok(OpenStackAttachedVolume {
        id: vol.id().clone(),
        name: vol.name().clone(),
        size_gb: vol.size(),
        device: String::new(),
        bootable: vol.bootable(),
        server_id: vol
            .attachments()
            .into_iter()
            .next()
            .map(|a| a.server_id.clone()),
    })
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CloneVolumeRequest {
    pub source_volume_id: String,
    pub name: Option<String>,
    pub size_gb: Option<u64>,
}

pub async fn clone_cinder_volume(
    cfg: &OpenStackConfig,
    req: &CloneVolumeRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let src = req.source_volume_id.trim();
    if src.is_empty() {
        return Err(LibvirtError::Invalid("source_volume_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut volume = serde_json::json!({ "source_volid": src });
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            volume["name"] = serde_json::json!(t);
        }
    }
    if let Some(sz) = req.size_gb {
        if sz > 0 {
            volume["size"] = serde_json::json!(sz);
        }
    }
    #[derive(Deserialize)]
    struct Resp {
        volume: VolJson,
    }
    #[derive(Deserialize)]
    struct VolJson {
        id: String,
        name: String,
        size: u64,
        #[serde(default)]
        bootable: bool,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["volumes"])
        .json(&serde_json::json!({ "volume": volume }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackAttachedVolume {
        id: parsed.volume.id,
        name: parsed.volume.name,
        size_gb: parsed.volume.size,
        device: String::new(),
        bootable: parsed.volume.bootable,
        server_id: None,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackVolumeTransfer {
    pub id: String,
    pub name: String,
    pub volume_id: String,
    pub auth_key: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CreateVolumeTransferRequest {
    pub volume_id: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AcceptVolumeTransferRequest {
    pub transfer_id: String,
    pub auth_key: String,
}

pub async fn list_volume_transfers(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackVolumeTransfer>, LibvirtError> {
    if !probe_cinder_reachable(cfg).await {
        return Ok(Vec::new());
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        transfers: Vec<TrJson>,
    }
    #[derive(Deserialize)]
    struct TrJson {
        id: String,
        name: String,
        volume_id: String,
        auth_key: Option<String>,
    }
    let resp = session
        .get(BLOCK_STORAGE, &["os-volume-transfer"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .transfers
        .into_iter()
        .map(|t| OpenStackVolumeTransfer {
            id: t.id,
            name: t.name,
            volume_id: t.volume_id,
            auth_key: t.auth_key,
        })
        .collect())
}

pub async fn create_volume_transfer(
    cfg: &OpenStackConfig,
    req: &CreateVolumeTransferRequest,
) -> Result<OpenStackVolumeTransfer, LibvirtError> {
    let vol = req.volume_id.trim();
    let name = req.name.trim();
    if vol.is_empty() || name.is_empty() {
        return Err(LibvirtError::Invalid(
            "volume_id and name are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "os-begin_transfer": {
            "name": name,
            "volume_id": vol
        }
    });
    #[derive(Deserialize)]
    struct Resp {
        transfer: TrJson,
    }
    #[derive(Deserialize)]
    struct TrJson {
        id: String,
        name: String,
        volume_id: String,
        auth_key: Option<String>,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["os-volume-transfer"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackVolumeTransfer {
        id: parsed.transfer.id,
        name: parsed.transfer.name,
        volume_id: parsed.transfer.volume_id,
        auth_key: parsed.transfer.auth_key,
    })
}

pub async fn accept_volume_transfer(
    cfg: &OpenStackConfig,
    req: &AcceptVolumeTransferRequest,
) -> Result<OpenStackVolumeTransfer, LibvirtError> {
    let tid = req.transfer_id.trim();
    let key = req.auth_key.trim();
    if tid.is_empty() || key.is_empty() {
        return Err(LibvirtError::Invalid(
            "transfer_id and auth_key are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "accept": {
            "transfer_id": tid,
            "auth_key": key
        }
    });
    #[derive(Deserialize)]
    struct Resp {
        transfer: TrJson,
    }
    #[derive(Deserialize)]
    struct TrJson {
        id: String,
        name: String,
        volume_id: String,
        auth_key: Option<String>,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["os-volume-transfer", tid, "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackVolumeTransfer {
        id: parsed.transfer.id,
        name: parsed.transfer.name,
        volume_id: parsed.transfer.volume_id,
        auth_key: parsed.transfer.auth_key,
    })
}

pub async fn delete_volume_transfer(
    cfg: &OpenStackConfig,
    transfer_id: &str,
) -> Result<(), LibvirtError> {
    let id = transfer_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("transfer_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(BLOCK_STORAGE, &["os-volume-transfer", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn get_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let id = volume_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("volume id is required".into()));
    }
    let cloud = connect_cloud(cfg).await?;
    let vol = cloud.get_volume(id).await.map_err(map_openstack_err)?;
    let att = vol.attachments().into_iter().next();
    Ok(OpenStackAttachedVolume {
        id: vol.id().clone(),
        name: vol.name().clone(),
        size_gb: vol.size(),
        device: att.as_ref().map(|a| a.device.clone()).unwrap_or_default(),
        bootable: vol.bootable(),
        server_id: att.map(|a| a.server_id.clone()),
    })
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct UpdateVolumeRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

pub async fn update_cinder_volume(
    cfg: &OpenStackConfig,
    volume_id: &str,
    req: &UpdateVolumeRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let session = connect_session(cfg).await?;
    let mut volume = serde_json::Map::new();
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            volume.insert("name".into(), serde_json::json!(t));
        }
    }
    if let Some(ref d) = req.description {
        volume.insert("description".into(), serde_json::json!(d.trim()));
    }
    if volume.is_empty() {
        return Err(LibvirtError::Invalid("name or description required".into()));
    }
    session
        .put(BLOCK_STORAGE, &["volumes", volume_id.trim()])
        .json(&serde_json::json!({ "volume": volume }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let cloud = connect_cloud(cfg).await?;
    let vol = cloud
        .get_volume(volume_id)
        .await
        .map_err(map_openstack_err)?;
    let att = vol.attachments().into_iter().next();
    Ok(OpenStackAttachedVolume {
        id: vol.id().clone(),
        name: vol.name().clone(),
        size_gb: vol.size(),
        device: att.as_ref().map(|a| a.device.clone()).unwrap_or_default(),
        bootable: vol.bootable(),
        server_id: att.map(|a| a.server_id.clone()),
    })
}

pub async fn set_volume_bootable(
    cfg: &OpenStackConfig,
    volume_id: &str,
    bootable: bool,
) -> Result<(), LibvirtError> {
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "os-set_bootable": { "bootable": bootable } });
    session
        .post(BLOCK_STORAGE, &["volumes", volume_id.trim(), "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CreateVolumeFromImageRequest {
    pub image_id: String,
    pub name: Option<String>,
    pub size_gb: Option<u64>,
}

pub async fn create_volume_from_image(
    cfg: &OpenStackConfig,
    req: &CreateVolumeFromImageRequest,
) -> Result<OpenStackAttachedVolume, LibvirtError> {
    let image_id = req.image_id.trim();
    if image_id.is_empty() {
        return Err(LibvirtError::Invalid("image_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut volume = serde_json::json!({ "imageRef": image_id });
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            volume["name"] = serde_json::json!(t);
        }
    }
    if let Some(sz) = req.size_gb {
        if sz > 0 {
            volume["size"] = serde_json::json!(sz);
        }
    }
    #[derive(Deserialize)]
    struct Resp {
        volume: VolJson,
    }
    #[derive(Deserialize)]
    struct VolJson {
        id: String,
        name: String,
        size: u64,
        #[serde(default)]
        bootable: bool,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["volumes"])
        .json(&serde_json::json!({ "volume": volume }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackAttachedVolume {
        id: parsed.volume.id,
        name: parsed.volume.name,
        size_gb: parsed.volume.size,
        device: String::new(),
        bootable: parsed.volume.bootable,
        server_id: None,
    })
}

pub async fn delete_cinder_snapshot(
    cfg: &OpenStackConfig,
    snapshot_id: &str,
) -> Result<(), LibvirtError> {
    let id = snapshot_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("snapshot_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(BLOCK_STORAGE, &["snapshots", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct UploadVolumeToImageRequest {
    pub image_name: String,
    pub disk_format: Option<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UploadVolumeToImageResponse {
    pub image_id: String,
    pub status: String,
}

pub async fn upload_volume_to_image(
    cfg: &OpenStackConfig,
    volume_id: &str,
    req: &UploadVolumeToImageRequest,
) -> Result<UploadVolumeToImageResponse, LibvirtError> {
    let id = volume_id.trim();
    let name = req.image_name.trim();
    if id.is_empty() || name.is_empty() {
        return Err(LibvirtError::Invalid(
            "volume id and image_name are required".into(),
        ));
    }
    let disk_format = req
        .disk_format
        .as_deref()
        .unwrap_or("qcow2")
        .trim()
        .to_string();
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "os-volume_upload_image": {
            "image_name": name,
            "disk_format": disk_format,
            "force": req.force
        }
    });
    #[derive(Deserialize)]
    struct Resp {
        #[serde(rename = "os-volume_upload_image")]
        upload: UploadOut,
    }
    #[derive(Deserialize)]
    struct UploadOut {
        image_id: String,
        status: String,
    }
    let resp = session
        .post(BLOCK_STORAGE, &["volumes", id, "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(UploadVolumeToImageResponse {
        image_id: parsed.upload.image_id,
        status: parsed.upload.status,
    })
}
