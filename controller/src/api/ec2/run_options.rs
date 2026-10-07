// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! The `RunInstances` parameters beyond image, type, count, key, user data and subnet. Each one is either applied
//! or refused with a clear error; none is dropped silently, because a client (Terraform above all) records what it
//! asked for and would otherwise show a permanent difference from what was built.

use std::collections::BTreeMap;

use uuid::Uuid;

use crate::state::AppState;

use super::Ec2Error;

type Params = BTreeMap<String, String>;

fn unsupported(msg: impl Into<String>) -> Ec2Error {
    Ec2Error::bad("UnsupportedOperation", msg)
}

/// An extra volume from `BlockDeviceMapping` (anything but the root device).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct ExtraVolume {
    /// `vdb`…`vdz`.
    pub device: String,
    pub size_gib: i64,
    pub delete_on_termination: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RunOptions {
    pub preemptible: bool,
    pub volumes: Vec<ExtraVolume>,
    /// Tags from `TagSpecification` of `ResourceType=volume`, for the volumes above.
    pub volume_tags: BTreeMap<String, String>,
}

fn truthy(v: Option<&String>) -> bool {
    v.is_some_and(|s| s == "true")
}

/// Device names clients use → (`vdX`, is the root device).
pub fn normalize_device(name: &str) -> Option<(String, bool)> {
    let d = name.strip_prefix("/dev/").unwrap_or(name);
    let letter = ["sd", "xvd", "vd"].iter().find_map(|p| d.strip_prefix(p))?;
    let mut chars = letter.chars();
    let c = chars.next()?;
    if !c.is_ascii_lowercase() {
        return None;
    }
    // `/dev/sda1` is the root partition of the root device `a`
    let rest: String = chars.collect();
    if !rest.is_empty() && !rest.chars().all(|x| x.is_ascii_digit()) {
        return None;
    }
    Some((format!("vd{c}"), c == 'a'))
}

/// Parameters that cannot be honoured, refused before anything is created.
pub fn reject_unsupported(p: &Params) -> Result<(), Ec2Error> {
    for key in p.keys() {
        let k = key.as_str();
        if k.starts_with("IamInstanceProfile") {
            return Err(unsupported("IamInstanceProfile is not supported: instances have no IAM roles"));
        }
        if k == "PrivateIpAddress" || k.starts_with("Ipv6") || k.starts_with("PrivateIpAddresses") {
            return Err(unsupported(format!("{k} is not supported when launching: assign addresses through a subnet or network interface after launch")));
        }
        if k.starts_with("NetworkInterface.") {
            return Err(unsupported("NetworkInterface at launch is not supported: use SubnetId and SecurityGroupId"));
        }
        if k.starts_with("CpuOptions") || k.starts_with("HibernationOptions") || k.starts_with("EnclaveOptions") || k.starts_with("LicenseSpecification") || k.starts_with("CapacityReservationSpecification") || k.starts_with("ElasticGpuSpecification") || k.starts_with("ElasticInferenceAccelerator") {
            return Err(unsupported(format!("{k} is not supported")));
        }
    }
    if truthy(p.get("Monitoring.Enabled")) {
        return Err(unsupported("Monitoring.Enabled=true is not supported: metrics are always collected, there is no separate detailed mode"));
    }
    if truthy(p.get("DisableApiTermination")) {
        return Err(unsupported("DisableApiTermination is not supported"));
    }
    if p.get("MetadataOptions.HttpTokens").is_some_and(|v| v == "required") {
        return Err(unsupported("MetadataOptions.HttpTokens=required is not supported: the metadata service answers without a token"));
    }
    if p.get("MetadataOptions.HttpEndpoint").is_some_and(|v| v == "disabled") {
        return Err(unsupported("MetadataOptions.HttpEndpoint=disabled is not supported: the metadata service cannot be switched off per instance"));
    }
    if p.get("MetadataOptions.InstanceMetadataTags").is_some_and(|v| v == "enabled") || p.get("MetadataOptions.HttpProtocolIpv6").is_some_and(|v| v == "enabled") {
        return Err(unsupported("MetadataOptions.InstanceMetadataTags and HttpProtocolIpv6 are not supported"));
    }
    for k in ["Placement.GroupName", "Placement.HostId", "Placement.HostResourceGroupArn", "Placement.PartitionNumber", "Placement.Affinity"] {
        if p.get(k).is_some_and(|v| !v.is_empty()) {
            return Err(unsupported(format!("{k} is not supported")));
        }
    }
    if p.get("Placement.Tenancy").is_some_and(|v| v != "default") {
        return Err(unsupported("Placement.Tenancy other than default is not supported"));
    }
    Ok(())
}

/// `InstanceMarketOptions` → preemptible (a spot instance is the cluster's preemptible instance).
pub fn spot(p: &Params) -> Result<bool, Ec2Error> {
    let Some(kind) = p.get("InstanceMarketOptions.MarketType") else {
        if p.keys().any(|k| k.starts_with("InstanceMarketOptions.")) {
            return Err(Ec2Error::bad("MissingParameter", "InstanceMarketOptions.MarketType is required"));
        }
        return Ok(false);
    };
    if kind != "spot" {
        return Err(Ec2Error::bad("InvalidParameterValue", "InstanceMarketOptions.MarketType must be spot"));
    }
    if p.get("InstanceMarketOptions.SpotOptions.SpotInstanceType").is_some_and(|v| v != "one-time") {
        return Err(unsupported("only one-time spot instances are supported"));
    }
    if p.get("InstanceMarketOptions.SpotOptions.InstanceInterruptionBehavior").is_some_and(|v| v != "terminate") {
        return Err(unsupported("a preempted instance is terminated: InstanceInterruptionBehavior must be terminate"));
    }
    if p.contains_key("InstanceMarketOptions.SpotOptions.BlockDurationMinutes") || p.contains_key("InstanceMarketOptions.SpotOptions.ValidUntil") {
        return Err(unsupported("spot block durations and expiry are not supported"));
    }
    Ok(true)
}

/// `TagSpecification.N` of resource types other than instance and volume carry tags we cannot place.
fn check_tag_specifications(p: &Params) -> Result<BTreeMap<String, String>, Ec2Error> {
    let mut volume_tags = BTreeMap::new();
    for n in 1..=10 {
        let Some(rt) = p.get(&format!("TagSpecification.{n}.ResourceType")) else { break };
        let has_tags = p.keys().any(|k| k.starts_with(&format!("TagSpecification.{n}.Tag.")));
        match rt.as_str() {
            "instance" => {}
            "volume" => {
                for m in 1..=50 {
                    let Some(k) = p.get(&format!("TagSpecification.{n}.Tag.{m}.Key")) else { break };
                    volume_tags.insert(k.clone(), p.get(&format!("TagSpecification.{n}.Tag.{m}.Value")).cloned().unwrap_or_default());
                }
            }
            other if has_tags => {
                return Err(unsupported(format!("TagSpecification for {other} is not supported at launch: tag it after launch")));
            }
            _ => {}
        }
    }
    Ok(volume_tags)
}

/// `BlockDeviceMapping.N` → the extra volumes to create and attach.
pub fn block_devices(p: &Params) -> Result<Vec<ExtraVolume>, Ec2Error> {
    let mut out: Vec<ExtraVolume> = Vec::new();
    for n in 1..=24 {
        let pre = format!("BlockDeviceMapping.{n}");
        let Some(name) = p.get(&format!("{pre}.DeviceName")) else {
            if p.keys().any(|k| k.starts_with(&format!("{pre}."))) {
                return Err(Ec2Error::bad("MissingParameter", format!("{pre}.DeviceName is required")));
            }
            break;
        };
        if p.contains_key(&format!("{pre}.NoDevice")) || p.contains_key(&format!("{pre}.VirtualName")) {
            return Err(unsupported(format!("{pre}: NoDevice and VirtualName (ephemeral disks) are not supported")));
        }
        for k in ["Ebs.SnapshotId", "Ebs.Iops", "Ebs.Throughput", "Ebs.KmsKeyId", "Ebs.OutpostArn"] {
            if p.contains_key(&format!("{pre}.{k}")) {
                return Err(unsupported(format!("{pre}.{k} is not supported")));
            }
        }
        if truthy(p.get(&format!("{pre}.Ebs.Encrypted"))) {
            return Err(unsupported(format!("{pre}.Ebs.Encrypted is not supported")));
        }
        let (device, root) = normalize_device(name).ok_or_else(|| Ec2Error::bad("InvalidBlockDeviceMapping", format!("The device name '{name}' is not valid")))?;
        let size = p.get(&format!("{pre}.Ebs.VolumeSize"));
        let dot = p.get(&format!("{pre}.Ebs.DeleteOnTermination")).map(|v| v == "true");
        if root {
            if size.is_some() {
                return Err(unsupported(format!("{pre}.Ebs.VolumeSize: the root disk takes its size from the image; resize it after launch")));
            }
            if dot == Some(false) {
                return Err(unsupported(format!("{pre}.Ebs.DeleteOnTermination=false for the root disk is not supported")));
            }
            continue;
        }
        let size: i64 = size
            .ok_or_else(|| Ec2Error::bad("MissingParameter", format!("{pre}.Ebs.VolumeSize is required")))?
            .parse()
            .map_err(|_| Ec2Error::bad("InvalidParameterValue", format!("{pre}.Ebs.VolumeSize must be a number of GiB")))?;
        if !(1..=16384).contains(&size) {
            return Err(Ec2Error::bad("InvalidParameterValue", format!("{pre}.Ebs.VolumeSize must be between 1 and 16384")));
        }
        if out.iter().any(|v| v.device == device) {
            return Err(Ec2Error::bad("InvalidBlockDeviceMapping", format!("The device '{name}' is mapped twice")));
        }
        out.push(ExtraVolume { device, size_gib: size, delete_on_termination: dot.unwrap_or(true) });
    }
    Ok(out)
}

/// Everything except the placement lookup, which needs the database.
pub fn parse(p: &Params) -> Result<RunOptions, Ec2Error> {
    reject_unsupported(p)?;
    Ok(RunOptions { preemptible: spot(p)?, volumes: block_devices(p)?, volume_tags: check_tag_specifications(p)? })
}

/// `Placement.AvailabilityZone` names a host (a zone is a host).
pub async fn host_for_zone(state: &AppState, p: &Params) -> Result<Option<Uuid>, Ec2Error> {
    let Some(zone) = p.get("Placement.AvailabilityZone").filter(|z| !z.is_empty()) else { return Ok(None) };
    let id: Option<Uuid> = crate::db::query_scalar("SELECT id FROM hosts WHERE hostname = ?").bind(zone).fetch_optional(&state.pool).await?;
    id.map(Some).ok_or_else(|| Ec2Error::bad("InvalidParameterValue", format!("Invalid availability zone: '{zone}'")))
}

/// The launch template's defaults for a `RunInstances` call: `LaunchTemplate.LaunchTemplateId|LaunchTemplateName` plus
/// `Version` (`1`, `$Latest` and `$Default` all name the only version a template has). Explicit parameters win.
pub async fn with_launch_template(state: &AppState, p: &Params) -> Result<Params, Ec2Error> {
    let by_id = p.get("LaunchTemplate.LaunchTemplateId");
    let by_name = p.get("LaunchTemplate.LaunchTemplateName");
    if by_id.is_none() && by_name.is_none() {
        if p.contains_key("LaunchTemplate.Version") {
            return Err(Ec2Error::bad("MissingParameter", "LaunchTemplate.LaunchTemplateId or LaunchTemplateName is required"));
        }
        return Ok(p.clone());
    }
    if by_id.is_some() && by_name.is_some() {
        return Err(Ec2Error::bad("InvalidParameterCombination", "give LaunchTemplateId or LaunchTemplateName, not both"));
    }
    if let Some(v) = p.get("LaunchTemplate.Version") {
        if !matches!(v.as_str(), "1" | "$Latest" | "$Default") {
            return Err(Ec2Error::bad("InvalidLaunchTemplateId.VersionNotFound", format!("The launch template version '{v}' does not exist")));
        }
    }
    let spec: String = if let Some(id) = by_id {
        let mut conn = state.pool.acquire().await?;
        let (kind, hex) = crate::resource_ids::parse(id).filter(|(k, _)| *k == crate::resource_ids::Kind::LaunchTemplate)
            .ok_or_else(|| Ec2Error::bad("InvalidLaunchTemplateId.Malformed", format!("The launch template id '{id}' is not valid")))?;
        match crate::resource_ids::resolve(&mut conn, kind, &hex).await? {
            crate::resource_ids::Lookup::Found(uuid) => crate::db::query_scalar("SELECT spec_json FROM cloud_launch_templates WHERE id = ?")
                .bind(uuid)
                .fetch_one(&mut *conn)
                .await?,
            _ => return Err(Ec2Error::bad("InvalidLaunchTemplateId.NotFound", format!("The launch template '{id}' does not exist"))),
        }
    } else {
        let name = by_name.cloned().unwrap_or_default();
        let rows: Vec<String> = crate::db::query_scalar("SELECT spec_json FROM cloud_launch_templates WHERE name = ?").bind(&name).fetch_all(&state.pool).await?;
        match rows.len() {
            0 => return Err(Ec2Error::bad("InvalidLaunchTemplateName.NotFoundException", format!("The launch template '{name}' does not exist"))),
            1 => rows.into_iter().next().unwrap_or_default(),
            _ => return Err(Ec2Error::bad("InvalidParameterValue", format!("{name} exists in several projects: use LaunchTemplateId"))),
        }
    };
    Ok(apply_template_spec(p, &spec))
}

/// Fill the parameters a template can supply (its image) without overriding what the caller sent.
pub fn apply_template_spec(p: &Params, spec_json: &str) -> Params {
    let mut out = p.clone();
    let v: serde_json::Value = serde_json::from_str(spec_json).unwrap_or_default();
    let image = v.pointer("/spec/template_ref").and_then(|x| x.as_str()).unwrap_or_default();
    if !image.is_empty() && !out.contains_key("ImageId") {
        out.insert("ImageId".into(), image.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pairs: &[(&str, &str)]) -> Params {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn device_names_from_every_client_convention() {
        assert_eq!(normalize_device("/dev/sdb"), Some(("vdb".into(), false)));
        assert_eq!(normalize_device("/dev/xvdc"), Some(("vdc".into(), false)));
        assert_eq!(normalize_device("vdd"), Some(("vdd".into(), false)));
        assert_eq!(normalize_device("/dev/sda1"), Some(("vda".into(), true)));
        assert_eq!(normalize_device("/dev/xvda"), Some(("vda".into(), true)));
        assert_eq!(normalize_device("/dev/nvme1n1"), None);
        assert_eq!(normalize_device("/dev/sdb-x"), None);
    }

    #[test]
    fn unsupported_parameters_are_refused_not_dropped() {
        for (k, v) in [
            ("IamInstanceProfile.Name", "role"),
            ("PrivateIpAddress", "10.0.0.5"),
            ("NetworkInterface.1.DeviceIndex", "0"),
            ("DisableApiTermination", "true"),
            ("MetadataOptions.HttpTokens", "required"),
            ("MetadataOptions.HttpEndpoint", "disabled"),
            ("Placement.GroupName", "pg"),
            ("Placement.Tenancy", "dedicated"),
            ("CpuOptions.CoreCount", "2"),
            ("Monitoring.Enabled", "true"),
        ] {
            let e = reject_unsupported(&p(&[(k, v)])).unwrap_err();
            assert_eq!(e.code, "UnsupportedOperation", "{k}");
        }
        // values that match what the platform does anyway pass
        assert!(reject_unsupported(&p(&[("DisableApiTermination", "false"), ("MetadataOptions.HttpTokens", "optional"), ("Placement.Tenancy", "default"), ("Monitoring.Enabled", "false")])).is_ok());
    }

    #[test]
    fn spot_becomes_preemptible() {
        assert!(!spot(&p(&[])).unwrap());
        assert!(spot(&p(&[("InstanceMarketOptions.MarketType", "spot")])).unwrap());
        assert!(spot(&p(&[("InstanceMarketOptions.MarketType", "spot"), ("InstanceMarketOptions.SpotOptions.MaxPrice", "0.1")])).unwrap());
        assert_eq!(spot(&p(&[("InstanceMarketOptions.MarketType", "capacity-block")])).unwrap_err().code, "InvalidParameterValue");
        assert_eq!(spot(&p(&[("InstanceMarketOptions.SpotOptions.MaxPrice", "1")])).unwrap_err().code, "MissingParameter");
        assert_eq!(
            spot(&p(&[("InstanceMarketOptions.MarketType", "spot"), ("InstanceMarketOptions.SpotOptions.SpotInstanceType", "persistent")])).unwrap_err().code,
            "UnsupportedOperation"
        );
    }

    #[test]
    fn block_devices_extra_volumes_and_root_rules() {
        let ok = p(&[
            ("BlockDeviceMapping.1.DeviceName", "/dev/sda1"),
            ("BlockDeviceMapping.1.Ebs.DeleteOnTermination", "true"),
            ("BlockDeviceMapping.1.Ebs.VolumeType", "gp3"),
            ("BlockDeviceMapping.2.DeviceName", "/dev/sdb"),
            ("BlockDeviceMapping.2.Ebs.VolumeSize", "50"),
            ("BlockDeviceMapping.3.DeviceName", "/dev/xvdc"),
            ("BlockDeviceMapping.3.Ebs.VolumeSize", "10"),
            ("BlockDeviceMapping.3.Ebs.DeleteOnTermination", "false"),
        ]);
        assert_eq!(
            block_devices(&ok).unwrap(),
            vec![
                ExtraVolume { device: "vdb".into(), size_gib: 50, delete_on_termination: true },
                ExtraVolume { device: "vdc".into(), size_gib: 10, delete_on_termination: false },
            ]
        );
        let root_size = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sda1"), ("BlockDeviceMapping.1.Ebs.VolumeSize", "100")]);
        assert_eq!(block_devices(&root_size).unwrap_err().code, "UnsupportedOperation");
        let keep_root = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sda1"), ("BlockDeviceMapping.1.Ebs.DeleteOnTermination", "false")]);
        assert_eq!(block_devices(&keep_root).unwrap_err().code, "UnsupportedOperation");
        let no_size = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sdb")]);
        assert_eq!(block_devices(&no_size).unwrap_err().code, "MissingParameter");
        let snap = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sdb"), ("BlockDeviceMapping.1.Ebs.VolumeSize", "5"), ("BlockDeviceMapping.1.Ebs.SnapshotId", "snap-1")]);
        assert_eq!(block_devices(&snap).unwrap_err().code, "UnsupportedOperation");
        let enc = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sdb"), ("BlockDeviceMapping.1.Ebs.VolumeSize", "5"), ("BlockDeviceMapping.1.Ebs.Encrypted", "true")]);
        assert_eq!(block_devices(&enc).unwrap_err().code, "UnsupportedOperation");
        let twice = p(&[
            ("BlockDeviceMapping.1.DeviceName", "/dev/sdb"),
            ("BlockDeviceMapping.1.Ebs.VolumeSize", "5"),
            ("BlockDeviceMapping.2.DeviceName", "/dev/xvdb"),
            ("BlockDeviceMapping.2.Ebs.VolumeSize", "5"),
        ]);
        assert_eq!(block_devices(&twice).unwrap_err().code, "InvalidBlockDeviceMapping");
        let bad_size = p(&[("BlockDeviceMapping.1.DeviceName", "/dev/sdb"), ("BlockDeviceMapping.1.Ebs.VolumeSize", "0")]);
        assert!(block_devices(&bad_size).is_err());
    }

    #[test]
    fn tag_specifications_for_volumes_are_kept_and_others_refused() {
        let ok = p(&[
            ("TagSpecification.1.ResourceType", "instance"),
            ("TagSpecification.1.Tag.1.Key", "Name"),
            ("TagSpecification.1.Tag.1.Value", "web"),
            ("TagSpecification.2.ResourceType", "volume"),
            ("TagSpecification.2.Tag.1.Key", "Env"),
            ("TagSpecification.2.Tag.1.Value", "prod"),
        ]);
        let o = parse(&ok).unwrap();
        assert_eq!(o.volume_tags.get("Env").map(String::as_str), Some("prod"));
        assert!(!o.volume_tags.contains_key("Name"));
        let eni = p(&[("TagSpecification.1.ResourceType", "network-interface"), ("TagSpecification.1.Tag.1.Key", "A"), ("TagSpecification.1.Tag.1.Value", "b")]);
        assert_eq!(parse(&eni).unwrap_err().code, "UnsupportedOperation");
    }

    #[test]
    fn launch_template_supplies_the_image_without_overriding() {
        let spec = r#"{"spec":{"template_ref":"ubuntu-24.04"}}"#;
        assert_eq!(apply_template_spec(&p(&[]), spec).get("ImageId").map(String::as_str), Some("ubuntu-24.04"));
        assert_eq!(apply_template_spec(&p(&[("ImageId", "ami-9")]), spec).get("ImageId").map(String::as_str), Some("ami-9"));
        assert!(apply_template_spec(&p(&[]), "not json").get("ImageId").is_none());
    }
}
