// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Compare active vs persistent (inactive) domain XML — Cockpit Machines needs-shutdown parity.

use serde::{Deserialize, Serialize};
use virt::connect::Connect;
use virt::sys::VIR_DOMAIN_XML_INACTIVE;

use super::domain::{lookup_domain, state_to_string};
use crate::state::{DiskInfo, FilesystemInfo, InterfaceInfo};
use crate::LibvirtError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingConfig {
    pub needs_shutdown: bool,
    pub state: String,
    pub persistent: bool,
    pub pending_changes: Vec<PendingChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingChange {
    pub category: String,
    pub summary: String,
}

pub fn get_pending_config(conn: &Connect, name: &str) -> Result<PendingConfig, LibvirtError> {
    let domain = lookup_domain(conn, name)?;
    let info = domain
        .get_info()
        .map_err(LibvirtError::map_op("Failed to get domain info"))?;
    let state = state_to_string(info.state);
    let persistent = domain.is_persistent().unwrap_or(false);

    if state != "running" && state != "paused" {
        return Ok(PendingConfig {
            needs_shutdown: false,
            state,
            persistent,
            pending_changes: vec![],
        });
    }

    let active_xml = domain
        .get_xml_desc(0)
        .map_err(LibvirtError::map_op("Failed to get active XML"))?;
    let inactive_xml = domain
        .get_xml_desc(VIR_DOMAIN_XML_INACTIVE)
        .map_err(LibvirtError::map_op("Failed to get inactive XML"))?;

    let mut changes = diff_configs(&active_xml, &inactive_xml);

    if changes.is_empty()
        && normalize_for_compare(&active_xml) != normalize_for_compare(&inactive_xml)
    {
        changes.push(PendingChange {
            category: "domain".into(),
            summary: "Persistent domain XML differs from the running configuration".into(),
        });
    }

    Ok(PendingConfig {
        needs_shutdown: !changes.is_empty(),
        state,
        persistent,
        pending_changes: changes,
    })
}

fn diff_configs(active: &str, inactive: &str) -> Vec<PendingChange> {
    let mut out = Vec::new();

    if vcpu_spec(active) != vcpu_spec(inactive) {
        out.push(PendingChange {
            category: "cpu".into(),
            summary: format!(
                "vCPU topology changed (running: {}, persistent: {})",
                vcpu_spec(active),
                vcpu_spec(inactive)
            ),
        });
    }

    if memory_kib(active) != memory_kib(inactive) {
        out.push(PendingChange {
            category: "memory".into(),
            summary: format!(
                "Memory size changed (running: {} MiB, persistent: {} MiB)",
                memory_kib(active) / 1024,
                memory_kib(inactive) / 1024
            ),
        });
    }

    diff_disks(active, inactive, &mut out);
    diff_interfaces(active, inactive, &mut out);
    diff_filesystems(active, inactive, &mut out);
    diff_boot_order(active, inactive, &mut out);
    diff_watchdog(active, inactive, &mut out);
    diff_hostdevs(active, inactive, &mut out);
    diff_vsock(active, inactive, &mut out);

    out
}

fn vcpu_spec(xml: &str) -> String {
    let block = crate::xml::split_blocks(xml, "vcpu").into_iter().next();
    block
        .map(|b| {
            let text = crate::xml::extract_text(&b, "vcpu").unwrap_or_default();
            let placement = crate::xml::extract_attr(&b, "vcpu", "placement").unwrap_or_default();
            if placement.is_empty() {
                text
            } else {
                format!("{text} ({placement})")
            }
        })
        .unwrap_or_default()
}

fn memory_kib(xml: &str) -> u64 {
    crate::xml::extract_text(xml, "memory")
        .and_then(|s| s.parse().ok())
        .or_else(|| crate::xml::extract_attr(xml, "memory", "value").and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

fn disk_fingerprint(d: &DiskInfo) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        d.target, d.device, d.source, d.driver, d.cache, d.readonly
    )
}

fn diff_disks(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let active_disks = super::domain::parse_disks_for_diff(active);
    let inactive_disks = super::domain::parse_disks_for_diff(inactive);
    let active_map: std::collections::BTreeMap<_, _> = active_disks
        .iter()
        .map(|d| (d.target.clone(), disk_fingerprint(d)))
        .collect();
    let inactive_map: std::collections::BTreeMap<_, _> = inactive_disks
        .iter()
        .map(|d| (d.target.clone(), disk_fingerprint(d)))
        .collect();

    for (target, fp) in &inactive_map {
        match active_map.get(target) {
            Some(active_fp) if active_fp != fp => out.push(PendingChange {
                category: "disk".into(),
                summary: format!(
                    "Disk {target} settings differ between running and persistent config"
                ),
            }),
            None => out.push(PendingChange {
                category: "disk".into(),
                summary: format!(
                    "Disk {target} added in persistent config (not active until shutdown)"
                ),
            }),
            _ => {}
        }
    }
    for target in active_map.keys() {
        if !inactive_map.contains_key(target) {
            out.push(PendingChange {
                category: "disk".into(),
                summary: format!(
                    "Disk {target} removed in persistent config (still active until shutdown)"
                ),
            });
        }
    }
}

fn iface_fingerprint(i: &InterfaceInfo) -> String {
    format!("{}:{}:{}", i.mac_address, i.source, i.model)
}

fn diff_interfaces(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let active_ifaces = super::domain::parse_interfaces_for_diff(active);
    let inactive_ifaces = super::domain::parse_interfaces_for_diff(inactive);
    let active_map: std::collections::BTreeMap<_, _> = active_ifaces
        .iter()
        .map(|i| (i.mac_address.clone(), iface_fingerprint(i)))
        .collect();
    let inactive_map: std::collections::BTreeMap<_, _> = inactive_ifaces
        .iter()
        .map(|i| (i.mac_address.clone(), iface_fingerprint(i)))
        .collect();

    for (mac, fp) in &inactive_map {
        match active_map.get(mac) {
            Some(active_fp) if active_fp != fp => out.push(PendingChange {
                category: "network".into(),
                summary: format!("NIC {mac} settings differ between running and persistent config"),
            }),
            None => out.push(PendingChange {
                category: "network".into(),
                summary: format!("NIC {mac} added in persistent config"),
            }),
            _ => {}
        }
    }
    for mac in active_map.keys() {
        if !inactive_map.contains_key(mac) {
            out.push(PendingChange {
                category: "network".into(),
                summary: format!("NIC {mac} removed in persistent config"),
            });
        }
    }
}

fn fs_fingerprint(f: &FilesystemInfo) -> String {
    format!("{}:{}", f.source, f.mount_tag)
}

fn diff_filesystems(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let active_fs = super::domain::parse_filesystems_for_diff(active);
    let inactive_fs = super::domain::parse_filesystems_for_diff(inactive);
    let active_set: std::collections::BTreeSet<_> = active_fs.iter().map(fs_fingerprint).collect();
    let inactive_set: std::collections::BTreeSet<_> =
        inactive_fs.iter().map(fs_fingerprint).collect();
    if active_set != inactive_set {
        out.push(PendingChange {
            category: "filesystem".into(),
            summary: "Virtiofs / shared directory configuration changed".into(),
        });
    }
}

fn boot_devices(xml: &str) -> Vec<String> {
    crate::xml::split_blocks(xml, "boot")
        .into_iter()
        .filter_map(|b| crate::xml::extract_attr(&b, "boot", "dev"))
        .collect()
}

fn diff_boot_order(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    if boot_devices(active) != boot_devices(inactive) {
        out.push(PendingChange {
            category: "boot".into(),
            summary: "Boot device order changed".into(),
        });
    }
}

fn watchdog_action(xml: &str) -> Option<String> {
    crate::xml::split_blocks(xml, "watchdog")
        .into_iter()
        .next()
        .and_then(|b| crate::xml::extract_attr(&b, "watchdog", "action"))
}

fn diff_watchdog(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let active_wd = active.contains("<watchdog");
    let inactive_wd = inactive.contains("<watchdog");
    if active_wd != inactive_wd {
        out.push(PendingChange {
            category: "watchdog".into(),
            summary: if inactive_wd && !active_wd {
                "Watchdog added in persistent config".into()
            } else {
                "Watchdog removed in persistent config".into()
            },
        });
        return;
    }
    if active_wd && watchdog_action(active) != watchdog_action(inactive) {
        out.push(PendingChange {
            category: "watchdog".into(),
            summary: "Watchdog action changed".into(),
        });
    }
}

fn hostdev_fingerprints(xml: &str) -> Vec<String> {
    crate::xml::split_blocks(xml, "hostdev")
        .into_iter()
        .map(|b| {
            let typ = crate::xml::extract_attr(&b, "hostdev", "type").unwrap_or_default();
            let addr = crate::xml::extract_attr(&b, "address", "domain")
                .or_else(|| crate::xml::extract_attr(&b, "source", "dev"))
                .unwrap_or_default();
            format!("{typ}:{addr}")
        })
        .collect()
}

fn diff_hostdevs(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let a = hostdev_fingerprints(active);
    let i = hostdev_fingerprints(inactive);
    if a != i {
        out.push(PendingChange {
            category: "hostdev".into(),
            summary: "Host device passthrough configuration changed".into(),
        });
    }
}

fn diff_vsock(active: &str, inactive: &str, out: &mut Vec<PendingChange>) {
    let active_v = active.contains("<vsock");
    let inactive_v = inactive.contains("<vsock");
    if active_v != inactive_v {
        out.push(PendingChange {
            category: "vsock".into(),
            summary: if inactive_v && !active_v {
                "Vsock device will be added after shutdown".into()
            } else {
                "Vsock device will be removed after shutdown".into()
            },
        });
    }
}

/// Strip runtime-only XML before coarse string comparison.
fn normalize_for_compare(xml: &str) -> String {
    let mut out = String::new();
    let mut skip_depth = 0i32;
    for line in xml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("<currentMemory") {
            skip_depth = 1;
            continue;
        }
        if skip_depth > 0 {
            if trimmed.contains("</currentMemory>") {
                skip_depth = 0;
            }
            continue;
        }
        let mut l = line.to_string();
        if l.contains("<vcpu") {
            l = l.replace(" current='", " _current='");
            l = l.replace(" current=\"", " _current=\"");
        }
        if l.contains("<graphics") && (l.contains("port='") || l.contains("port=\"")) {
            continue;
        }
        out.push_str(&l);
        out.push('\n');
    }
    out
}
