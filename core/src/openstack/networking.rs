// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Neutron floating IPs for Nova instances.

use std::net::IpAddr;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::compute::{connect_cloud, map_openstack_err};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackFloatingIp {
    pub id: String,
    pub address: String,
    pub status: String,
    pub instance_id: Option<String>,
    pub fixed_address: Option<String>,
    pub network_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AssociateFloatingIpRequest {
    /// Existing floating IP id (optional). When omitted, creates a new FIP on `floating_network`.
    pub floating_ip_id: Option<String>,
    /// External/provider network for new FIPs (required when creating).
    pub floating_network: Option<String>,
}

pub async fn list_floating_ips(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackFloatingIp>, LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let ports = cloud.find_ports().all().await.map_err(map_openstack_err)?;
    let port_device: std::collections::HashMap<String, String> = ports
        .iter()
        .filter_map(|p| {
            let device = p.device_id().clone().filter(|d| !d.is_empty())?;
            Some((p.id().clone(), device))
        })
        .collect();
    let fips = cloud.list_floating_ips().await.map_err(map_openstack_err)?;
    let mut out = Vec::with_capacity(fips.len());
    for fip in fips {
        let instance_id = fip
            .port_id()
            .as_ref()
            .and_then(|pid| port_device.get(pid).cloned());
        out.push(fip_row(&fip, instance_id));
    }
    out.sort_by(|a, b| a.address.cmp(&b.address));
    Ok(out)
}

pub async fn get_floating_ip(
    cfg: &OpenStackConfig,
    floating_ip_id: &str,
) -> Result<OpenStackFloatingIp, LibvirtError> {
    let id = floating_ip_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("floating_ip_id is required".into()));
    }
    let cloud = connect_cloud(cfg).await?;
    let fip = cloud.get_floating_ip(id).await.map_err(map_openstack_err)?;
    let ports = cloud.find_ports().all().await.map_err(map_openstack_err)?;
    let port_device: std::collections::HashMap<String, String> = ports
        .iter()
        .filter_map(|p| {
            let device = p.device_id().clone().filter(|d| !d.is_empty())?;
            Some((p.id().clone(), device))
        })
        .collect();
    let instance_id = fip
        .port_id()
        .as_ref()
        .and_then(|pid| port_device.get(pid).cloned());
    Ok(fip_row(&fip, instance_id))
}

pub async fn list_instance_floating_ips(
    cfg: &OpenStackConfig,
    instance_id: &str,
) -> Result<Vec<OpenStackFloatingIp>, LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let ports = cloud
        .find_ports()
        .with_device_id(instance_id.trim())
        .all()
        .await
        .map_err(map_openstack_err)?;
    let port_ids: std::collections::HashSet<String> =
        ports.iter().map(|p| p.id().clone()).collect();
    let fips = cloud.list_floating_ips().await.map_err(map_openstack_err)?;
    let mut out = Vec::new();
    for fip in fips {
        if let Some(pid) = fip.port_id() {
            if port_ids.contains(pid) {
                out.push(fip_row(&fip, Some(instance_id.trim().to_string())));
            }
        }
    }
    Ok(out)
}

pub async fn associate_floating_ip(
    cfg: &OpenStackConfig,
    instance_id: &str,
    req: &AssociateFloatingIpRequest,
) -> Result<OpenStackFloatingIp, LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let ports = cloud
        .find_ports()
        .with_device_id(instance_id.trim())
        .all()
        .await
        .map_err(map_openstack_err)?;
    let port = ports.into_iter().next().ok_or_else(|| {
        LibvirtError::Invalid(format!("no Neutron port found for instance {instance_id}"))
    })?;

    let mut fip = if let Some(ref fid) = req.floating_ip_id {
        if fid.trim().is_empty() {
            return Err(LibvirtError::Invalid("floating_ip_id is empty".into()));
        }
        cloud
            .get_floating_ip(fid.trim())
            .await
            .map_err(map_openstack_err)?
    } else {
        let net = req
            .floating_network
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                LibvirtError::Invalid(
                    "floating_network is required when creating a new floating IP".into(),
                )
            })?;
        cloud
            .new_floating_ip(net)
            .create()
            .await
            .map_err(map_openstack_err)?
    };

    fip.associate(port.id().as_str(), None)
        .await
        .map_err(map_openstack_err)?;
    Ok(fip_row(&fip, Some(instance_id.trim().to_string())))
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CreateFloatingIpRequest {
    pub floating_network_id: String,
}

pub async fn create_floating_ip(
    cfg: &OpenStackConfig,
    req: &CreateFloatingIpRequest,
) -> Result<OpenStackFloatingIp, LibvirtError> {
    let net = req.floating_network_id.trim();
    if net.is_empty() {
        return Err(LibvirtError::Invalid(
            "floating_network_id is required".into(),
        ));
    }
    let cloud = connect_cloud(cfg).await?;
    let fip = cloud
        .new_floating_ip(net)
        .create()
        .await
        .map_err(map_openstack_err)?;
    Ok(fip_row(&fip, None))
}

pub async fn delete_floating_ip(
    cfg: &OpenStackConfig,
    floating_ip_id: &str,
) -> Result<(), LibvirtError> {
    let id = floating_ip_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("floating_ip_id is required".into()));
    }
    // Dissociate first so Neutron allows delete on busy clouds.
    let _ = dissociate_floating_ip(cfg, id).await;
    use super::auth::{connect_session, map_osauth_err};
    use osauth::services::NETWORK;
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["floatingips", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn dissociate_floating_ip(
    cfg: &OpenStackConfig,
    floating_ip_id: &str,
) -> Result<(), LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let mut fip = cloud
        .get_floating_ip(floating_ip_id.trim())
        .await
        .map_err(map_openstack_err)?;
    fip.dissociate().await.map_err(map_openstack_err)
}

fn fip_row(
    fip: &openstack::network::FloatingIp,
    instance_id: Option<String>,
) -> OpenStackFloatingIp {
    OpenStackFloatingIp {
        id: fip.id().clone(),
        address: fip.floating_ip_address().to_string(),
        status: format!("{:?}", fip.status()),
        instance_id,
        fixed_address: fip.fixed_ip_address().map(|a: IpAddr| a.to_string()),
        network_id: Some(fip.floating_network_id().clone()),
    }
}
