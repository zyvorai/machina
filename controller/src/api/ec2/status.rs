// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Instance status, and the DescribeInstances fields the first cut left empty.
//! Status is the host's observed state. There is no second reachability probe.

use std::collections::BTreeMap;

use uuid::Uuid;

use crate::resource_ids::{ec2_id, Kind};
use crate::state::AppState;

use super::{indexed, instance_state, xml_escape, Ec2Error};

type Params = BTreeMap<String, String>;

fn bad(code: &'static str, msg: impl Into<String>) -> Ec2Error {
    Ec2Error::bad(code, msg)
}

fn reachability(observed: &str) -> &'static str {
    match observed {
        "running" | "blocked" => "passed",
        "shutoff" | "stopped" | "paused" | "suspended" | "pmsuspended" | "terminated" => "passed",
        "crashed" => "failed",
        _ => "initializing",
    }
}

pub async fn describe_instance_status(state: &AppState, p: &Params) -> Result<String, Ec2Error> {
    let wanted = indexed(p, "InstanceId");
    let include_all = matches!(p.get("IncludeAllInstances").map(String::as_str), Some("true") | Some("1"));
    let rows: Vec<(Uuid, String)> = crate::db::query_as(
        "SELECT id, observed_state FROM vms WHERE COALESCE(inventory_source, 'libvirt') != 'kubevirt' ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut items = String::new();
    for (id, observed) in rows {
        let eid = ec2_id(Kind::Vm, id);
        if !wanted.is_empty() && !wanted.contains(&eid) {
            continue;
        }
        let (code, name) = instance_state(&observed);
        if !include_all && name != "running" {
            continue;
        }
        let status = if observed == "crashed" { "impaired" } else { "ok" };
        items.push_str(&format!(
            "<item><instanceId>{eid}</instanceId><instanceState><code>{code}</code><name>{name}</name></instanceState>\
<systemStatus><status>{status}</status><details><item><name>reachability</name><status>{}</status></item></details></systemStatus>\
<instanceStatus><status>{status}</status><details><item><name>reachability</name><status>{}</status></item></details></instanceStatus></item>",
            reachability(&observed),
            reachability(&observed)
        ));
    }
    for w in &wanted {
        if !items.contains(w) {
            return Err(bad("InvalidInstanceID.NotFound", format!("The instance ID '{w}' does not exist")));
        }
    }
    Ok(format!("<instanceStatusSet>{items}</instanceStatusSet>"))
}

/// Extra DescribeInstances elements for one machine. Empty string when the row is a tombstone.
pub async fn instance_extra(state: &AppState, id: Uuid) -> Result<String, Ec2Error> {
    let vm: Option<(Option<String>, Option<Uuid>)> =
        crate::db::query_as("SELECT json_extract(spec_json, '$.template_ref'), host_id FROM vms WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((template_ref, host_id)) = vm else {
        return Ok(String::new());
    };
    let image = match template_ref {
        Some(name) => {
            let tid: Option<Uuid> = crate::db::query_scalar("SELECT id FROM templates WHERE name = ? ORDER BY version LIMIT 1")
                .bind(&name)
                .fetch_optional(&state.pool)
                .await?;
            tid.map(|t| ec2_id(Kind::Image, t)).unwrap_or(name)
        }
        None => String::new(),
    };
    let zone = match host_id {
        Some(host) => crate::db::query_scalar::<_, String>("SELECT hostname FROM hosts WHERE id = ?")
            .bind(host)
            .fetch_optional(&state.pool)
            .await?
            .unwrap_or_default(),
        None => String::new(),
    };
    let volumes: Vec<(Uuid, Option<String>, bool)> = crate::db::query_as(
        "SELECT id, attached_device, delete_on_termination FROM volumes WHERE attached_vm_id = ? ORDER BY attached_device",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let block: String = volumes
        .iter()
        .map(|(vid, dev, del)| {
            let device = dev.as_deref().unwrap_or("vda");
            format!(
                "<item><deviceName>/dev/{device}</deviceName><ebs><volumeId>{}</volumeId><status>attached</status><deleteOnTermination>{del}</deleteOnTermination></ebs></item>",
                ec2_id(Kind::Volume, *vid)
            )
        })
        .collect();
    let groups: Vec<(Uuid, String)> = crate::db::query_as(
        "SELECT g.id, g.name FROM security_groups g JOIN instance_security_groups i ON i.sg_id = g.id WHERE i.vm_id = ? ORDER BY g.name",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let group_xml: String = groups
        .iter()
        .map(|(gid, name)| format!("<item><groupId>{}</groupId><groupName>{}</groupName></item>", ec2_id(Kind::SecurityGroup, *gid), xml_escape(name)))
        .collect();
    let ports: Vec<(Uuid, Option<String>, Option<String>, Option<String>)> =
        crate::db::query_as("SELECT id, subnet_id, mac_address, private_ip FROM ports WHERE vm_id = ? ORDER BY created_at")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;
    let nics: String = ports
        .iter()
        .enumerate()
        .map(|(n, (pid, subnet, mac, ip))| {
            let subnet = subnet.as_deref().and_then(|s| Uuid::parse_str(s).ok()).map(|u| ec2_id(Kind::Subnet, u)).unwrap_or_default();
            format!(
                "<item><networkInterfaceId>{}</networkInterfaceId><subnetId>{subnet}</subnetId><status>in-use</status><macAddress>{}</macAddress><privateIpAddress>{}</privateIpAddress><attachment><deviceIndex>{n}</deviceIndex><status>attached</status><deleteOnTermination>false</deleteOnTermination></attachment><groupSet>{group_xml}</groupSet></item>",
                ec2_id(Kind::Port, *pid),
                xml_escape(mac.as_deref().unwrap_or("")),
                xml_escape(ip.as_deref().unwrap_or(""))
            )
        })
        .collect();
    let attrs = super::instance_attrs::load(state, id).await?;
    let group = attrs.placement_group.as_deref().map(|g| format!("<groupName>{}</groupName>", xml_escape(g))).unwrap_or_default();
    Ok(format!(
        "<imageId>{}</imageId><placement><availabilityZone>{}</availabilityZone>{group}<tenancy>default</tenancy></placement><rootDeviceName>/dev/vda</rootDeviceName><rootDeviceType>ebs</rootDeviceType><blockDeviceMapping>{block}</blockDeviceMapping><monitoring><state>{}</state></monitoring><ebsOptimized>{}</ebsOptimized><sourceDestCheck>true</sourceDestCheck><metadataOptions><state>applied</state><httpTokens>optional</httpTokens><httpPutResponseHopLimit>{}</httpPutResponseHopLimit><httpEndpoint>{}</httpEndpoint></metadataOptions><networkInterfaceSet>{nics}</networkInterfaceSet><groupSet>{group_xml}</groupSet>",
        xml_escape(&image),
        xml_escape(&zone),
        if attrs.monitoring { "enabled" } else { "disabled" },
        attrs.ebs_optimized,
        attrs.metadata_hop_limit,
        if attrs.metadata_endpoint { "enabled" } else { "disabled" }
    ))
}

/// Replace the empty `<imageId/>` in `instance_core` with this, and drop the duplicate tag.
pub fn splice(core: &str, extra: &str) -> String {
    core.replace("<imageId/>", extra)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splice_fills_the_empty_image_slot() {
        let core = "<item><instanceId>i-1</instanceId><imageId/><instanceType>m1.small</instanceType></item>";
        let out = splice(core, "<imageId>ami-1</imageId><placement><availabilityZone>host-a</availabilityZone></placement>");
        assert!(!out.contains("<imageId/>"));
        assert!(out.contains("ami-1"));
        assert!(out.contains("m1.small"));
    }
}
