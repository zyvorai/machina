// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Network interfaces. A port is an ENI (`eni-`). Creating one with `InstanceId` attaches it;
//! the REST handler waits for the NIC attach. There is no secondary-address call.

use std::collections::BTreeMap;

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use uuid::Uuid;

use crate::auth::{require_operator, AuthUser};
use crate::resource_ids::{ec2_id, Kind};
use crate::state::AppState;

use super::more::{api_err, resolve};
use super::{xml_escape, Ec2Error};

type Params = BTreeMap<String, String>;

fn bad(code: &'static str, msg: impl Into<String>) -> Ec2Error {
    Ec2Error::bad(code, msg)
}

fn need(p: &Params, k: &str) -> Result<String, Ec2Error> {
    p.get(k).cloned().ok_or_else(|| bad("MissingParameter", format!("The request must contain the parameter {k}")))
}

async fn network_for_subnet(state: &AppState, subnet: &str) -> Result<Uuid, Ec2Error> {
    let id = resolve(state, Kind::Subnet, subnet, "InvalidSubnetID.NotFound").await?;
    let network: Option<Uuid> = crate::db::query_scalar("SELECT network_id FROM cloud_subnets WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    network.ok_or_else(|| bad("InvalidSubnetID.NotFound", "the subnet has no network"))
}

pub async fn create_network_interface(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let network_id = if let Some(subnet) = p.get("SubnetId") {
        network_for_subnet(state, subnet).await?
    } else {
        need(p, "NetworkId")?.parse().map_err(|_| bad("InvalidParameterValue", "NetworkId must be a network UUID"))?
    };
    let vm_id = match p.get("InstanceId") {
        Some(id) => Some(resolve(state, Kind::Vm, id, "InvalidInstanceID.NotFound").await?),
        None => None,
    };
    let sg = match p.get("GroupId.1") {
        Some(id) => Some(resolve(state, Kind::SecurityGroup, id, "InvalidGroup.NotFound").await?),
        None => None,
    };
    let body = crate::api::networking::CreatePortBody {
        network_id,
        vm_id,
        security_group_id: sg,
        project_id: p.get("ProjectId").and_then(|s| Uuid::parse_str(s).ok()),
        private_ip: p.get("PrivateIpAddress").cloned(),
        description: p.get("Description").cloned().unwrap_or_default(),
    };
    let Json(row) = crate::api::networking::create_port(State(state.clone()), Extension(actor.clone()), Json(body)).await.map_err(api_err)?;
    let instance = row.vm_id.map(|id| format!("<attachment><instanceId>{}</instanceId><status>attached</status></attachment>", ec2_id(Kind::Vm, id))).unwrap_or_default();
    Ok(format!(
        "<networkInterface><networkInterfaceId>{}</networkInterfaceId><status>{}</status><macAddress>{}</macAddress><privateIpAddress>{}</privateIpAddress>{instance}</networkInterface>",
        ec2_id(Kind::Port, row.id),
        xml_escape(&row.status),
        xml_escape(row.mac_address.as_deref().unwrap_or("")),
        xml_escape(row.private_ip.as_deref().unwrap_or(""))
    ))
}

pub async fn delete_network_interface(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let id = resolve(state, Kind::Port, &need(p, "NetworkInterfaceId")?, "InvalidNetworkInterfaceID.NotFound").await?;
    let _ = crate::api::networking::delete_port(State(state.clone()), Extension(actor.clone()), Path(id)).await.map_err(api_err)?;
    Ok("<return>true</return>".into())
}

pub async fn attach_network_interface(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    if p.get("NetworkInterfaceId").is_some() {
        return Err(bad("UnsupportedOperation", "an existing interface cannot be moved; create one with InstanceId set"));
    }
    create_network_interface(state, actor, p).await
}
