// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::process::Command;

/// Parse `host:/export/path` for libvirt netfs pools.
fn parse_nfs_source(path: &str) -> anyhow::Result<(String, String)> {
    let path = path.trim();
    let (host, export) = path
        .split_once(':')
        .ok_or_else(|| anyhow::anyhow!("NFS path must be host:/export (got '{path}')"))?;
    if host.is_empty() {
        anyhow::bail!("NFS host is empty");
    }
    let export = if export.is_empty() {
        "/".into()
    } else if export.starts_with('/') {
        export.to_string()
    } else {
        format!("/{export}")
    };
    Ok((host.to_string(), export))
}

fn local_mount_for_pool(pool_name: &str) -> String {
    format!("/var/lib/machina/nfs/{pool_name}")
}

fn parse_ceph_pool(path: &str) -> String {
    let p = path.trim();
    if let Some(rest) = p.strip_prefix("ceph:") {
        return rest.to_string();
    }
    if let Some(rest) = p.strip_prefix("rbd:") {
        return rest.to_string();
    }
    if p.starts_with("rbd/") {
        return p.to_string();
    }
    format!("rbd/{p}")
}

fn parse_zfs_dataset(path: &str) -> anyhow::Result<(String, String)> {
    let p = path.trim().trim_start_matches('/');
    let (zpool, dataset) = p
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("ZFS path must be zpool/dataset (got '{path}')"))?;
    if zpool.is_empty() || dataset.is_empty() {
        anyhow::bail!("ZFS zpool and dataset must be non-empty");
    }
    Ok((zpool.to_string(), dataset.to_string()))
}

pub fn provision_storage_pool(pool_name: &str, backend: &str, path: &str) -> anyhow::Result<()> {
    let backend = backend.trim().to_ascii_lowercase();
    let path = path.trim();

    let output = match backend.as_str() {
        "lvm" | "lvm-thin" | "logical" => {
            if !path.starts_with("/dev/") {
                anyhow::bail!("LVM pool path must be a device path under /dev/ (got '{path}')");
            }
            Command::new("virsh")
                .args(["pool-define-as", pool_name, "logical", "--target", path])
                .output()?
        }
        "nfs" | "netfs" => {
            let (host, export) = parse_nfs_source(path)?;
            let target = local_mount_for_pool(pool_name);
            std::fs::create_dir_all(&target)?;
            Command::new("virsh")
                .args([
                    "pool-define-as",
                    pool_name,
                    "netfs",
                    "--source-host",
                    &host,
                    "--source-dir",
                    &export,
                    "--target",
                    &target,
                ])
                .output()?
        }
        "ceph" | "rbd" => {
            let source_dev = parse_ceph_pool(path);
            let target = if source_dev.starts_with("/dev/") {
                source_dev.clone()
            } else {
                format!("/dev/{source_dev}")
            };
            Command::new("virsh")
                .args([
                    "pool-define-as",
                    pool_name,
                    "rbd",
                    "--source-dev",
                    &source_dev,
                    "--target",
                    &target,
                ])
                .output()?
        }
        "iscsi" => {
            if !path.starts_with("iqn.") {
                anyhow::bail!(
                    "iSCSI path must be a target IQN (e.g. iqn.2020-01.com.example:storage)"
                );
            }
            let target = format!("/var/lib/machina/iscsi/{pool_name}");
            std::fs::create_dir_all(&target)?;
            Command::new("virsh")
                .args([
                    "pool-define-as",
                    pool_name,
                    "iscsi",
                    "--source-dev",
                    path,
                    "--target",
                    &target,
                ])
                .output()?
        }
        "zfs" => {
            let (zpool, dataset) = parse_zfs_dataset(path)?;
            let source_dev = format!("{zpool}/{dataset}");
            let target = format!("/{zpool}/{dataset}");
            Command::new("virsh")
                .args([
                    "pool-define-as",
                    pool_name,
                    "zfs",
                    "--source-dev",
                    &source_dev,
                    "--target",
                    &target,
                ])
                .output()?
        }
        "directory" | "dir" => {
            if path.contains(':') {
                anyhow::bail!(
                    "directory backend cannot use host:path NFS syntax — use backend nfs"
                );
            }
            std::fs::create_dir_all(path)?;
            Command::new("virsh")
                .args(["pool-define-as", pool_name, "dir", "--target", path])
                .output()?
        }
        other => {
            anyhow::bail!(
                "unsupported storage backend '{other}' — use directory, nfs, lvm, ceph, iscsi, or zfs"
            );
        }
    };

    if !output.status.success() {
        anyhow::bail!(
            "virsh pool-define-as failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    for sub in ["pool-build", "pool-start"] {
        let out = Command::new("virsh").args([sub, pool_name]).output()?;
        if !out.status.success() {
            let hint = if backend == "nfs" || backend == "netfs" {
                " — verify NFS export is reachable and mount options on the hypervisor"
            } else if backend == "lvm" || backend == "logical" {
                " — verify the logical volume exists and is not in use"
            } else if backend == "ceph" || backend == "rbd" {
                " — verify Ceph cluster, librbd, and pool permissions on the hypervisor"
            } else if backend == "iscsi" {
                " — verify iSCSI target is reachable and libvirt iscsi pool prerequisites"
            } else if backend == "zfs" {
                " — verify ZFS pool/dataset exists and is imported on the host"
            } else {
                ""
            };
            anyhow::bail!(
                "virsh {sub} failed: {}{}",
                String::from_utf8_lossy(&out.stderr),
                hint
            );
        }
    }
    Ok(())
}

pub fn provision_network(
    network_name: &str,
    _backend: &str,
    vlan_id: i32,
    bridge: &str,
) -> anyhow::Result<()> {
    let bridge_name = if bridge.is_empty() { "virbr0" } else { bridge };
    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    let safe_name = xml_escape(network_name);
    let safe_bridge = xml_escape(bridge_name);
    let xml = if vlan_id > 0 {
        format!(
            "<network><name>{safe_name}</name><bridge name='{safe_bridge}'/><vlan><tag id='{vlan_id}'/></vlan></network>"
        )
    } else {
        format!(
            "<network><name>{safe_name}</name><forward mode='bridge'/><bridge name='{safe_bridge}'/></network>"
        )
    };
    let tmp = std::env::temp_dir().join(format!("machina-net-{network_name}.xml"));
    std::fs::write(&tmp, xml)?;
    let define = Command::new("virsh")
        .args(["net-define", tmp.to_string_lossy().as_ref()])
        .output()?;
    let _ = std::fs::remove_file(&tmp);
    if !define.status.success() {
        anyhow::bail!(
            "virsh net-define failed: {}",
            String::from_utf8_lossy(&define.stderr)
        );
    }
    for sub in ["net-start", "net-autostart"] {
        let out = Command::new("virsh").args([sub, network_name]).output()?;
        if !out.status.success() {
            anyhow::bail!(
                "virsh {sub} failed: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_nfs_source_splits_host_export() {
        let (h, e) = parse_nfs_source("10.0.0.5:/export/machina").unwrap();
        assert_eq!(h, "10.0.0.5");
        assert_eq!(e, "/export/machina");
    }

    #[test]
    fn parse_nfs_adds_leading_slash() {
        let (_, e) = parse_nfs_source("nas.local:export").unwrap();
        assert_eq!(e, "/export");
    }

    #[test]
    fn parse_ceph_pool_normalizes() {
        assert_eq!(parse_ceph_pool("vms"), "rbd/vms");
        assert_eq!(parse_ceph_pool("ceph:machina"), "machina");
    }

    #[test]
    fn parse_zfs_dataset_splits() {
        let (z, d) = parse_zfs_dataset("tank/machina").unwrap();
        assert_eq!(z, "tank");
        assert_eq!(d, "machina");
    }
}
