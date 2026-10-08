// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Account, zone, and launch-template actions. A zone is a host. A launch template is a
//! `cloud_launch_templates` row (`lt-`); creating one needs `ProjectId` because templates are
//! project-scoped and the EC2 call has no account-default project.

use std::collections::BTreeMap;

use axum::extract::{Path, State};
use axum::{Extension, Json};
use uuid::Uuid;

use crate::auth::{require_operator, AuthUser};
use crate::resource_ids::{ec2_id, Kind};
use crate::state::AppState;

use super::more::api_err;
use super::{xml_escape, Ec2Error};

type Params = BTreeMap<String, String>;

fn bad(code: &'static str, msg: impl Into<String>) -> Ec2Error {
    Ec2Error::bad(code, msg)
}

fn need(p: &Params, k: &str) -> Result<String, Ec2Error> {
    p.get(k).cloned().ok_or_else(|| bad("MissingParameter", format!("The request must contain the parameter {k}")))
}

pub fn zone_id(host: Uuid) -> String {
    format!("az-{}", &host.simple().to_string()[..17])
}

pub async fn describe_availability_zones(state: &AppState, _actor: &AuthUser, _p: &Params) -> Result<String, Ec2Error> {
    let rows: Vec<(Uuid, String, String, bool)> = crate::db::query_as(
        "SELECT id, hostname, state, COALESCE(maintenance_mode, FALSE) FROM hosts ORDER BY hostname",
    )
    .fetch_all(&state.pool)
    .await?;
    let items: String = rows
        .into_iter()
        .map(|(id, hostname, state, maintenance)| {
            let available = !maintenance && matches!(state.as_str(), "online" | "up" | "ready" | "active");
            let zone_state = if available { "available" } else { "impaired" };
            format!(
                "<item><zoneName>{}</zoneName><zoneId>{}</zoneId><regionName>machina</regionName><zoneState>{zone_state}</zoneState></item>",
                xml_escape(&hostname),
                zone_id(id)
            )
        })
        .collect();
    Ok(format!("<availabilityZoneInfo>{items}</availabilityZoneInfo>"))
}

pub async fn describe_account_attributes(state: &AppState, _actor: &AuthUser, _p: &Params) -> Result<String, Ec2Error> {
    let instances: i64 = crate::db::query_scalar("SELECT COUNT(*) FROM vms").fetch_one(&state.pool).await?;
    let addresses: i64 = crate::db::query_scalar("SELECT COUNT(*) FROM elastic_ips").fetch_one(&state.pool).await?;
    let default_vpc: Option<String> = crate::db::query_scalar("SELECT id FROM cloud_vpcs ORDER BY name LIMIT 1")
        .fetch_optional(&state.pool)
        .await?
        .map(|id: Uuid| ec2_id(Kind::Vpc, id));
    Ok(format!(
        "<accountAttributeSet>\
<item><attributeName>supported-platforms</attributeName><attributeValueSet><item><attributeValue>VPC</attributeValue></item></attributeValueSet></item>\
<item><attributeName>used-instances</attributeName><attributeValueSet><item><attributeValue>{instances}</attributeValue></item></attributeValueSet></item>\
<item><attributeName>used-elastic-ips</attributeName><attributeValueSet><item><attributeValue>{addresses}</attributeValue></item></attributeValueSet></item>\
<item><attributeName>default-vpc</attributeName><attributeValueSet><item><attributeValue>{}</attributeValue></item></attributeValueSet></item>\
</accountAttributeSet>",
        xml_escape(default_vpc.as_deref().unwrap_or("none"))
    ))
}

/// The VM a launch template stores: one core, 1 GiB, the default 10 GiB root volume, the image, UEFI, no HA. Built from
/// `VirtualMachine::new` so it carries what the validator requires (a storage volume, the current API version).
pub(super) fn template_vm(name: &str, image: &str) -> serde_json::Value {
    let mut vm = machina_spec::VirtualMachine::new(name, "1Gi");
    vm.spec.template_ref = Some(image.to_string());
    vm.spec.firmware = "uefi".into();
    vm.spec.ha.enabled = false;
    serde_json::to_value(&vm).unwrap_or_default()
}

/// Stores a launch template through the REST handler (project access, validation and audit stay there).
/// Returns `(id, project, name)`.
pub(super) async fn create_template_row(
    state: &AppState,
    actor: &AuthUser,
    project: Uuid,
    name: &str,
    vm: serde_json::Value,
) -> Result<(Uuid, Uuid, String), Ec2Error> {
    let body: crate::api::cloud::elastic::CreateTemplate =
        serde_json::from_value(serde_json::json!({ "name": name, "vm": vm })).map_err(|e| bad("InvalidParameterValue", e.to_string()))?;
    let Json(row) = crate::api::cloud::elastic::create_template(State(state.clone()), Extension(actor.clone()), Path(project), Json(body))
        .await
        .map_err(api_err)?;
    Ok((row.id, row.project_id, row.name))
}

pub async fn delete_launch_template(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let id = super::more::resolve(state, Kind::LaunchTemplate, &need(p, "LaunchTemplateId")?, "InvalidLaunchTemplateId.NotFound").await?;
    let _ = crate::api::cloud::elastic::delete_template(State(state.clone()), Extension(actor.clone()), Path(id)).await.map_err(api_err)?;
    Ok("<return>true</return>".into())
}

/// Subnet id → libvirt network name, for `RunInstances`. `None` when the call did not ask.
pub async fn network_for_run(state: &AppState, p: &Params) -> Result<Option<String>, Ec2Error> {
    let Some(subnet) = p.get("SubnetId") else { return Ok(None) };
    let id = super::more::resolve(state, Kind::Subnet, subnet, "InvalidSubnetID.NotFound").await?;
    let name: Option<String> = crate::db::query_scalar("SELECT name FROM cloud_subnets WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    name.ok_or_else(|| bad("InvalidSubnetID.NotFound", format!("The subnet '{subnet}' does not exist"))).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_id_is_stable() {
        let id = Uuid::nil();
        assert_eq!(zone_id(id), "az-00000000000000000");
    }
}
