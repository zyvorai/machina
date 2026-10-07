// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Account, zone, and launch-template actions. A zone is a host. A launch template is a
//! `cloud_launch_templates` row (`lt-`); creating one needs `ProjectId` because templates are
//! project-scoped and the EC2 call has no account-default project.

use std::collections::BTreeMap;

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
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
        "SELECT id, hostname, state, COALESCE(maintenance_mode, 0) FROM hosts ORDER BY hostname",
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

fn template_item(id: Uuid, project: Uuid, name: &str) -> String {
    format!(
        "<item><launchTemplateId>{}</launchTemplateId><launchTemplateName>{}</launchTemplateName><defaultVersionNumber>1</defaultVersionNumber><latestVersionNumber>1</latestVersionNumber><projectId>{}</projectId></item>",
        ec2_id(Kind::LaunchTemplate, id),
        xml_escape(name),
        project
    )
}

pub async fn describe_launch_templates(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let project = p.get("ProjectId").and_then(|s| Uuid::parse_str(s).ok());
    let rows: Vec<(Uuid, Uuid, String)> = match project {
        Some(project) => {
            crate::db::query_as("SELECT id, project_id, name FROM cloud_launch_templates WHERE project_id = ? ORDER BY name")
                .bind(project)
                .fetch_all(&state.pool)
                .await?
        }
        None => crate::db::query_as("SELECT id, project_id, name FROM cloud_launch_templates ORDER BY name").fetch_all(&state.pool).await?,
    };
    let items: String = rows.into_iter().map(|(id, project, name)| template_item(id, project, &name)).collect();
    Ok(format!("<launchTemplates>{items}</launchTemplates>"))
}

pub async fn describe_launch_template_versions(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let id = super::more::resolve(state, Kind::LaunchTemplate, &need(p, "LaunchTemplateId")?, "InvalidLaunchTemplateId.NotFound").await?;
    let row: Option<(Uuid, String)> = crate::db::query_as("SELECT project_id, name FROM cloud_launch_templates WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((project, name)) = row else {
        return Err(bad("InvalidLaunchTemplateId.NotFound", "the launch template does not exist"));
    };
    Ok(format!(
        "<launchTemplateVersionSet><item><launchTemplateId>{}</launchTemplateId><launchTemplateName>{}</launchTemplateName><versionNumber>1</versionNumber><defaultVersion>true</defaultVersion><projectId>{project}</projectId></item></launchTemplateVersionSet>",
        ec2_id(Kind::LaunchTemplate, id),
        xml_escape(&name)
    ))
}

pub async fn create_launch_template(state: &AppState, actor: &AuthUser, p: &Params) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let name = need(p, "LaunchTemplateName")?;
    let project: Uuid = need(p, "ProjectId")?.parse().map_err(|_| bad("InvalidParameterValue", "ProjectId must be a project UUID"))?;
    let image = p.get("ImageId").cloned().unwrap_or_default();
    let vm = serde_json::json!({
        "api_version": "machina/v1",
        "kind": "VirtualMachine",
        "metadata": { "name": name },
        "spec": {
            "cpu": { "sockets": 1, "cores": 1 },
            "memory": "1Gi",
            "template_ref": image,
            "firmware": "uefi",
            "ha": { "enabled": false }
        }
    });
    let body: crate::api::cloud::elastic::CreateTemplate =
        serde_json::from_value(serde_json::json!({ "name": name, "vm": vm })).map_err(|e| bad("InvalidParameterValue", e.to_string()))?;
    let Json(row) = crate::api::cloud::elastic::create_template(State(state.clone()), Extension(actor.clone()), Path(project), Json(body))
        .await
        .map_err(api_err)?;
    Ok(template_item(row.id, row.project_id, &row.name))
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
