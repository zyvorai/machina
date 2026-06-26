// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Nova shelve, migrate, rescue, backup, and interface attach/detach.

use osauth::services::COMPUTE;
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_osauth_err};
use super::compute::get_instance;
use super::resources::snapshot_instance;

async fn server_action(
    cfg: &OpenStackConfig,
    id: &str,
    body: serde_json::Value,
) -> Result<(), LibvirtError> {
    let session = connect_session(cfg).await?;
    session
        .post(COMPUTE, &["servers", id.trim(), "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn shelve_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    server_action(
        cfg,
        id,
        serde_json::json!({ "shelve": serde_json::Value::Null }),
    )
    .await
}

pub async fn unshelve_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    server_action(
        cfg,
        id,
        serde_json::json!({ "unshelve": serde_json::Value::Null }),
    )
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrateInstanceRequest {
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub block_migration: bool,
    pub host: Option<String>,
}

pub async fn migrate_instance(
    cfg: &OpenStackConfig,
    id: &str,
    req: &MigrateInstanceRequest,
) -> Result<(), LibvirtError> {
    if req.live {
        let mut body = serde_json::json!({
            "os-migrateLive": {
                "block_migration": req.block_migration,
                "disk_over_commit": false
            }
        });
        if let Some(ref host) = req.host {
            let h = host.trim();
            if !h.is_empty() {
                body["os-migrateLive"]["host"] = serde_json::json!(h);
            }
        }
        server_action(cfg, id, body).await
    } else {
        let mut body = serde_json::json!({ "migrate": serde_json::Value::Null });
        if let Some(ref host) = req.host {
            let h = host.trim();
            if !h.is_empty() {
                body["migrate"] = serde_json::json!({ "host": h });
            }
        }
        server_action(cfg, id, body).await
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RescueInstanceRequest {
    pub image: Option<String>,
    pub admin_pass: Option<String>,
}

pub async fn rescue_instance(
    cfg: &OpenStackConfig,
    id: &str,
    req: &RescueInstanceRequest,
) -> Result<(), LibvirtError> {
    let mut rescue = serde_json::Map::new();
    if let Some(ref img) = req.image {
        let i = img.trim();
        if !i.is_empty() {
            rescue.insert("rescue_image_ref".into(), serde_json::json!(i));
        }
    }
    if let Some(ref pass) = req.admin_pass {
        let p = pass.trim();
        if !p.is_empty() {
            rescue.insert("adminPass".into(), serde_json::json!(p));
        }
    }
    server_action(cfg, id, serde_json::json!({ "rescue": rescue })).await
}

pub async fn unrescue_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    server_action(
        cfg,
        id,
        serde_json::json!({ "unrescue": serde_json::Value::Null }),
    )
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInstanceRequest {
    pub name: String,
    pub backup_type: Option<String>,
    pub rotation: Option<u32>,
}

pub async fn backup_instance(
    cfg: &OpenStackConfig,
    id: &str,
    req: &BackupInstanceRequest,
) -> Result<(), LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("backup name is required".into()));
    }
    let backup_type = req
        .backup_type
        .as_deref()
        .unwrap_or("daily")
        .trim()
        .to_string();
    let rotation = req.rotation.unwrap_or(1);
    let body = serde_json::json!({
        "createBackup": {
            "name": name,
            "backup_type": backup_type,
            "rotation": rotation
        }
    });
    match server_action(cfg, id, body).await {
        Ok(()) => Ok(()),
        Err(_) => snapshot_instance(cfg, id, name).await,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachInterfaceRequest {
    pub network_id: Option<String>,
    pub port_id: Option<String>,
    pub fixed_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackInstanceInterface {
    pub port_id: String,
    pub net_id: String,
    pub mac_addr: String,
    pub fixed_ips: Vec<String>,
}

pub async fn list_instance_interfaces(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<Vec<OpenStackInstanceInterface>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct IfList {
        #[serde(rename = "interfaceAttachments")]
        interface_attachments: Vec<IfJson>,
    }
    #[derive(Deserialize)]
    struct IfJson {
        port_id: String,
        net_id: String,
        mac_addr: String,
        #[serde(default)]
        fixed_ips: Vec<FixedIp>,
    }
    #[derive(Deserialize)]
    struct FixedIp {
        ip_address: String,
    }
    let resp = session
        .get(COMPUTE, &["servers", id.trim(), "os-interface"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: IfList = resp.json().await.map_err(super::auth::map_json_err)?;
    Ok(body
        .interface_attachments
        .into_iter()
        .map(|i| OpenStackInstanceInterface {
            port_id: i.port_id,
            net_id: i.net_id,
            mac_addr: i.mac_addr,
            fixed_ips: i.fixed_ips.into_iter().map(|f| f.ip_address).collect(),
        })
        .collect())
}

pub async fn attach_interface(
    cfg: &OpenStackConfig,
    id: &str,
    req: &AttachInterfaceRequest,
) -> Result<OpenStackInstanceInterface, LibvirtError> {
    let port = req
        .port_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let net = req
        .network_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if port.is_none() && net.is_none() {
        return Err(LibvirtError::Invalid(
            "network_id or port_id is required".into(),
        ));
    }
    let mut attach = serde_json::Map::new();
    if let Some(p) = port {
        attach.insert("port_id".into(), serde_json::json!(p));
    }
    if let Some(n) = net {
        attach.insert("net_id".into(), serde_json::json!(n));
    }
    if let Some(ref ip) = req.fixed_ip {
        let fixed = ip.trim();
        if !fixed.is_empty() {
            attach.insert("fixed_ip".into(), serde_json::json!(fixed));
        }
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct IfResp {
        #[serde(rename = "interfaceAttachment")]
        interface_attachment: IfJson,
    }
    #[derive(Deserialize)]
    struct IfJson {
        port_id: String,
        net_id: String,
        mac_addr: String,
        #[serde(default)]
        fixed_ips: Vec<FixedIp>,
    }
    #[derive(Deserialize)]
    struct FixedIp {
        ip_address: String,
    }
    let resp = session
        .post(COMPUTE, &["servers", id.trim(), "os-interface"])
        .json(&serde_json::json!({ "interfaceAttachment": attach }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: IfResp = resp.json().await.map_err(super::auth::map_json_err)?;
    let i = body.interface_attachment;
    Ok(OpenStackInstanceInterface {
        port_id: i.port_id,
        net_id: i.net_id,
        mac_addr: i.mac_addr,
        fixed_ips: i.fixed_ips.into_iter().map(|f| f.ip_address).collect(),
    })
}

pub async fn detach_interface(
    cfg: &OpenStackConfig,
    id: &str,
    port_id: &str,
) -> Result<(), LibvirtError> {
    let port = port_id.trim();
    if port.is_empty() {
        return Err(LibvirtError::Invalid("port_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(COMPUTE, &["servers", id.trim(), "os-interface", port])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

/// Heat stack id/name from instance metadata when present.
pub async fn instance_stack_hint(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<Option<serde_json::Value>, LibvirtError> {
    let inst = get_instance(cfg, id).await?;
    let meta = &inst.metadata;
    let stack_id = meta
        .get("OS::stack_id")
        .or_else(|| meta.get("heat_stack_id"))
        .cloned();
    let stack_name = meta.get("OS::stack_name").cloned();
    if stack_id.is_none() && stack_name.is_none() {
        return Ok(None);
    }
    Ok(Some(serde_json::json!({
        "stack_id": stack_id,
        "stack_name": stack_name,
    })))
}
