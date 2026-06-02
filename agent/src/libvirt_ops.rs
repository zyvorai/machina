// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::path::Path;
use std::process::Command;

use machina_core::libvirt::domain;
use machina_core::LibvirtError;
use machina_spec::VirtualMachine;
use machina_translate::domain_xml_from_spec;
use virt::connect::Connect;
use virt::domain::Domain;

#[derive(Debug, Clone)]
pub struct VmListEntry {
    pub name: String,
    pub uuid: String,
    pub state: String,
    pub vcpus: u32,
    pub memory_mb: u64,
    pub cpu_percent: f32,
    pub memory_used_mib: u64,
    pub disk_read_iops: u64,
    pub disk_write_iops: u64,
}

pub struct LibvirtCtx {
    pub conn: Connect,
}

#[derive(Debug, Clone, Default)]
pub struct CloudInitParams {
    pub user: String,
    pub password: String,
    pub ssh_pubkey: String,
}

impl LibvirtCtx {
    pub fn open(uri: &str) -> Result<Self, LibvirtError> {
        let conn = Connect::open(Some(uri))
            .map_err(|e| LibvirtError::Connection(format!("libvirt connect {uri}: {e}")))?;
        Ok(Self { conn })
    }

    pub fn list_vms(&self) -> Result<Vec<VmListEntry>, LibvirtError> {
        let vms = domain::list_vms(&self.conn)?;
        Ok(vms
            .into_iter()
            .map(|v| {
                let running = v.state == "running";
                let mut entry = VmListEntry {
                    name: v.name.clone(),
                    uuid: String::new(),
                    state: v.state,
                    vcpus: v.vcpus,
                    memory_mb: v.memory_mb as u64,
                    cpu_percent: 0.0,
                    memory_used_mib: 0,
                    disk_read_iops: 0,
                    disk_write_iops: 0,
                };
                if let Ok(dom) = Domain::lookup_by_name(&self.conn, &v.name) {
                    if let Ok(uuid) = dom.get_uuid_string() {
                        entry.uuid = uuid;
                    }
                }
                if running {
                    if let Ok(m) = machina_core::libvirt::metrics::get_vm_metrics(&self.conn, &v.name) {
                        entry.memory_used_mib = m.memory_used_mb;
                        entry.disk_read_iops = m.disk_rd_ops;
                        entry.disk_write_iops = m.disk_wr_ops;
                    }
                }
                entry
            })
            .collect())
    }

    pub fn list_networks(&self) -> Result<Vec<machina_core::NetworkInfo>, LibvirtError> {
        machina_core::libvirt::network::list_networks(&self.conn)
    }

    pub fn list_storage_pools(&self) -> Result<Vec<(machina_core::StoragePoolInfo, String)>, LibvirtError> {
        use machina_core::libvirt::storage::{list_pools, target_path_from_pool_xml};
        use virt::storage_pool::StoragePool;

        let pools = list_pools(&self.conn)?;
        let mut out = Vec::with_capacity(pools.len());
        for info in pools {
            let path = StoragePool::lookup_by_name(&self.conn, &info.name)
                .ok()
                .and_then(|p| p.get_xml_desc(0).ok())
                .and_then(|xml| target_path_from_pool_xml(&xml))
                .unwrap_or_default();
            out.push((info, path));
        }
        Ok(out)
    }

    pub fn apply_vm(
        &self,
        vm: &VirtualMachine,
        disk_path: &str,
        template_source: Option<&str>,
        cloud: &CloudInitParams,
        images_dir: &str,
    ) -> Result<(String, String), LibvirtError> {
        vm.validate()
            .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
        if !Path::new(disk_path).exists() {
            if let Some(src) = template_source.filter(|s| !s.is_empty()) {
                create_linked_clone(src, disk_path)?;
            } else {
                let size_gib = vm.root_disk_gib().map_err(|e| LibvirtError::Invalid(e.to_string()))?;
                create_qcow2(disk_path, size_gib)?;
            }
        }

        let cloud_iso = maybe_cloud_init_iso(vm, cloud, images_dir)?;

        let xml = domain_xml_from_spec(vm, disk_path, "qcow2", cloud_iso.as_deref())
            .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
        let dom = Domain::define_xml(&self.conn, &xml)
            .map_err(|e| LibvirtError::Operation(format!("define VM: {e}")))?;
        let uuid = dom
            .get_uuid_string()
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        Ok((vm.metadata.name.clone(), uuid))
    }

    pub fn host_info(&self) -> Result<(String, String, String), LibvirtError> {
        let libvirt_version = self
            .conn
            .get_lib_version()
            .map(|v| format!("{v}"))
            .unwrap_or_default();
        let caps = self
            .conn
            .get_capabilities()
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        let cpu_model = parse_cpu_model(&caps).unwrap_or_else(|| "unknown".into());
        let qemu_version = qemu_version_from_path();
        Ok((cpu_model, libvirt_version, qemu_version))
    }

    pub fn precheck_migrate(
        &self,
        vm_name: &str,
        dest_cpu_model: &str,
        dest_libvirt_version: &str,
    ) -> Result<Vec<(String, bool, String)>, LibvirtError> {
        let mut checks = Vec::new();
        let dom = Domain::lookup_by_name(&self.conn, vm_name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
        let xml = dom
            .get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        let src_cpu = parse_domain_cpu(&xml).unwrap_or_else(|| "unknown".into());
        let (_, src_lv, _) = self.host_info()?;

        let cpu_ok = dest_cpu_model.is_empty()
            || src_cpu == "unknown"
            || dest_cpu_model == "unknown"
            || cpu_compatible(&src_cpu, dest_cpu_model);
        checks.push((
            "cpu_compatible".into(),
            cpu_ok,
            format!("source CPU '{src_cpu}' vs dest '{dest_cpu_model}'"),
        ));

        let lv_ok = dest_libvirt_version.is_empty()
            || libvirt_version_major(&src_lv) <= libvirt_version_major(dest_libvirt_version);
        checks.push((
            "libvirt_version".into(),
            lv_ok,
            format!("source libvirt {src_lv} vs dest {dest_libvirt_version}"),
        ));

        Ok(checks)
    }

    pub fn fence_host(
        &self,
        hostname: &str,
        method: &str,
        ipmi_address: &str,
        ipmi_user: &str,
        ipmi_pass: &str,
        shell_command: &str,
    ) -> Result<String, LibvirtError> {
        if method == "ipmi" {
            return self.fence_ipmi(ipmi_address, ipmi_user, ipmi_pass);
        }
        let template = if shell_command.is_empty() {
            std::env::var("MACHINA_FENCE_COMMAND").unwrap_or_default()
        } else {
            shell_command.to_string()
        };
        if template.is_empty() {
            return Err(LibvirtError::Operation(
                "MACHINA_FENCE_COMMAND not configured".into(),
            ));
        }
        let cmdline = template.replace("{hostname}", hostname);
        let output = Command::new("sh")
            .arg("-c")
            .arg(&cmdline)
            .output()
            .map_err(|e| LibvirtError::Operation(format!("fence command: {e}")))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(LibvirtError::Operation(format!(
                "fence failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }

    fn fence_ipmi(&self, address: &str, user: &str, pass: &str) -> Result<String, LibvirtError> {
        if address.is_empty() || user.is_empty() {
            return Err(LibvirtError::Operation(
                "IPMI address and username required".into(),
            ));
        }
        let output = Command::new("ipmitool")
            .args([
                "-I", "lanplus", "-H", address, "-U", user, "-P", pass, "power", "off",
            ])
            .output()
            .map_err(|e| LibvirtError::Operation(format!("ipmitool: {e}")))?;
        if output.status.success() {
            Ok(format!("IPMI power off {address}"))
        } else {
            Err(LibvirtError::Operation(format!(
                "ipmitool failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }

    pub fn power(&self, name: &str, action: &str) -> Result<String, LibvirtError> {
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        let active = dom.is_active().unwrap_or(false);
        match action {
            "start" => {
                if !active {
                    dom.create().map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            "stop" => {
                if active {
                    dom.destroy().map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            "reboot" => {
                if active {
                    dom.reboot(0).map_err(|e| LibvirtError::Operation(e.to_string()))?;
                } else {
                    dom.create().map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            _ => return Err(LibvirtError::Invalid(format!("unknown power action: {action}"))),
        }
        let info = dom.get_info().map_err(|e| LibvirtError::Operation(e.to_string()))?;
        Ok(machina_core::libvirt::metrics::domain_state_label(info.state).to_string())
    }

    pub fn delete(&self, name: &str) -> Result<(), LibvirtError> {
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        if dom.is_active().unwrap_or(false) {
            let _ = dom.destroy();
        }
        dom.undefine()
            .map_err(|e| LibvirtError::Operation(format!("undefine: {e}")))?;
        Ok(())
    }

    pub fn resolve_vnc(&self, name: &str) -> Result<(String, u16), LibvirtError> {
        machina_core::libvirt::vnc::resolve_vnc_tcp(&self.conn, name)
    }

    pub fn migrate(&self, name: &str, dest_uri: &str, live: bool) -> Result<(), LibvirtError> {
        machina_core::libvirt::migrate::migrate_vm_uri(&self.conn, name, dest_uri, live, None, 0)
    }

    pub fn clone_vm(&self, source: &str, new_name: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::clone::clone_vm(&self.conn, source, new_name)
    }

    pub fn create_snapshot(&self, vm_name: &str, snap_name: &str, description: &str) -> Result<(), LibvirtError> {
        let req = machina_core::state::CreateSnapshotRequest {
            name: snap_name.to_string(),
            description: description.to_string(),
            disk_only: false,
            storage_mode: String::new(),
            memory_snapshot: String::new(),
            memory_file: String::new(),
            external_disk_dir: String::new(),
            external_memory_dir: String::new(),
            disks: Vec::new(),
            atomic: true,
            reuse_external: false,
        };
        machina_core::libvirt::snapshot::create_snapshot(&self.conn, vm_name, &req)
    }

    pub fn delete_snapshot(&self, vm_name: &str, snap_name: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::snapshot::delete_snapshot(&self.conn, vm_name, snap_name)
    }

    pub fn list_snapshots(&self, vm_name: &str) -> Result<Vec<(String, String, i64, bool)>, LibvirtError> {
        Ok(machina_core::libvirt::snapshot::list_snapshots(&self.conn, vm_name)?
            .into_iter()
            .map(|s| (s.name, s.state, s.creation_time, s.is_current))
            .collect())
    }

    pub fn revert_snapshot(&self, vm_name: &str, snap_name: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::snapshot::revert_snapshot(&self.conn, vm_name, snap_name)
    }

    pub fn clone_from_snapshot(
        &self,
        vm_name: &str,
        snap_name: &str,
        new_name: &str,
        new_disk_path: &str,
        revert_source: bool,
    ) -> Result<(String, String), LibvirtError> {
        machina_spec::validate_name(new_name)
            .map_err(|e| LibvirtError::Invalid(e.to_string()))?;

        if revert_source {
            self.revert_snapshot(vm_name, snap_name)?;
            self.clone_vm(vm_name, new_name)?;
        } else {
            let dom = Domain::lookup_by_name(&self.conn, vm_name)
                .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
            let xml = dom
                .get_xml_desc(0)
                .map_err(|e| LibvirtError::Operation(e.to_string()))?;
            let disk_path = extract_disk_path(&xml).ok_or_else(|| {
                LibvirtError::Operation(format!("no disk path found for VM '{vm_name}'"))
            })?;

            let status = Command::new("qemu-img")
                .args([
                    "convert",
                    "-O",
                    "qcow2",
                    "-s",
                    snap_name,
                    &disk_path,
                    new_disk_path,
                ])
                .status()
                .map_err(|e| LibvirtError::Operation(format!("qemu-img convert: {e}")))?;
            if !status.success() {
                return Err(LibvirtError::Operation(format!(
                    "qemu-img convert at snapshot '{snap_name}' failed (try revert_source=true for libvirt revert+clone)"
                )));
            }

            define_cloned_domain(&self.conn, &xml, new_name, new_disk_path)?;
        }

        let new_dom = Domain::lookup_by_name(&self.conn, new_name)
            .map_err(|e| LibvirtError::Operation(format!("lookup cloned VM: {e}")))?;
        let uuid = new_dom
            .get_uuid_string()
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        Ok((new_name.to_string(), uuid))
    }

    pub fn host_resource_stats(&self) -> Result<(f32, u64, u64), LibvirtError> {
        let stats = machina_core::libvirt::extras::get_host_stats();
        Ok((
            stats.cpu_percent as f32,
            stats.memory_used_mb,
            stats.memory_total_mb,
        ))
    }

    pub fn restore_vm_backup(&self, vm_name: &str, backup_path: &str) -> Result<(), LibvirtError> {
        let dom = Domain::lookup_by_name(&self.conn, vm_name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
        let was_running = dom.is_active().unwrap_or(false);
        if was_running {
            dom.destroy()
                .map_err(|e| LibvirtError::Operation(format!("stop for restore: {e}")))?;
        }
        let xml = dom
            .get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        let disk_path = extract_disk_path(&xml).ok_or_else(|| {
            LibvirtError::Operation(format!("no disk path found for VM '{vm_name}'"))
        })?;
        let status = Command::new("qemu-img")
            .args(["convert", "-O", "qcow2", backup_path, &disk_path])
            .status()
            .map_err(|e| LibvirtError::Operation(format!("qemu-img restore: {e}")))?;
        if !status.success() {
            return Err(LibvirtError::Operation("qemu-img restore failed".into()));
        }
        if was_running {
            dom.create()
                .map_err(|e| LibvirtError::Operation(format!("start after restore: {e}")))?;
        }
        Ok(())
    }

    pub fn backup_vm_disk(&self, vm_name: &str, dest_path: &str) -> Result<String, LibvirtError> {
        let dom = Domain::lookup_by_name(&self.conn, vm_name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
        let xml = dom
            .get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        let disk_path = extract_disk_path(&xml).ok_or_else(|| {
            LibvirtError::Operation(format!("no disk path found for VM '{vm_name}'"))
        })?;
        let status = Command::new("qemu-img")
            .args(["convert", "-O", "qcow2", &disk_path, dest_path])
            .status()
            .map_err(|e| LibvirtError::Operation(format!("qemu-img convert: {e}")))?;
        if !status.success() {
            return Err(LibvirtError::Operation("qemu-img backup failed".into()));
        }
        Ok(dest_path.to_string())
    }

    pub fn attach_disk(&self, vm_name: &str, disk_path: &str, target_dev: &str) -> Result<(), LibvirtError> {
        use std::process::Command;
        if !std::path::Path::new(disk_path).exists() {
            return Err(LibvirtError::NotFound(format!("disk not found: {disk_path}")));
        }
        let out = Command::new("virsh")
            .args([
                "attach-disk",
                vm_name,
                disk_path,
                target_dev,
                "--config",
                "--persistent",
            ])
            .output()
            .map_err(|e| LibvirtError::Operation(format!("virsh attach-disk: {e}")))?;
        if !out.status.success() {
            return Err(LibvirtError::Operation(format!(
                "virsh attach-disk failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        Ok(())
    }

    pub fn guest_health(&self, name: &str) -> Result<GuestHealthSummary, LibvirtError> {
        let report = machina_core::libvirt::guest_health::gather_guest_health(&self.conn, name)?;
        let guest_ip = report
            .guest
            .as_ref()
            .and_then(|g| g.ip_addresses.first().map(|ip| ip.address.clone()))
            .unwrap_or_default();
        let guest_hostname = report
            .guest
            .as_ref()
            .map(|g| g.hostname.clone())
            .unwrap_or_default();
        Ok(GuestHealthSummary {
            state: report.state,
            agent_reachable: report.agent_reachable,
            healthy: report.healthy,
            os_pretty_name: report.os_pretty_name.unwrap_or_default(),
            guest_ip,
            guest_hostname,
            issues: report.issues,
        })
    }

    pub fn guest_firewall_ports(
        &self,
        name: &str,
    ) -> Result<(Vec<machina_core::GuestListeningPort>, bool), LibvirtError> {
        let health = self.guest_health(name)?;
        let ports = machina_core::scan_guest_listening_ports(name);
        Ok((ports, health.agent_reachable))
    }

    pub fn install_guest_tools(&self, name: &str) -> Result<(), LibvirtError> {
        use virt::domain::Domain;
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        let xml = dom
            .get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        if xml.contains("org.qemu.guest_agent.0") {
            return Ok(());
        }
        let channel = r#"<channel type='unix'>
  <target type='virtio' name='org.qemu.guest_agent.0'/>
</channel>"#;
        let flags = virt::sys::VIR_DOMAIN_AFFECT_CONFIG | virt::sys::VIR_DOMAIN_AFFECT_LIVE;
        dom.attach_device_flags(channel, flags)
            .map_err(|e| LibvirtError::Operation(format!("attach guest agent channel: {e}")))?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct GuestHealthSummary {
    pub state: String,
    pub agent_reachable: bool,
    pub healthy: bool,
    pub os_pretty_name: String,
    pub guest_ip: String,
    pub guest_hostname: String,
    pub issues: Vec<String>,
}

pub fn disk_path_from_xml(xml: &str) -> Option<String> {
    extract_disk_path(xml)
}

fn extract_disk_path(xml: &str) -> Option<String> {
    for line in xml.lines() {
        let t = line.trim();
        if t.starts_with("<source file='") {
            return t
                .trim_start_matches("<source file='")
                .split('\'')
                .next()
                .map(str::to_string);
        }
    }
    None
}

fn define_cloned_domain(
    conn: &Connect,
    source_xml: &str,
    new_name: &str,
    new_disk_path: &str,
) -> Result<(), LibvirtError> {
    let new_xml = replace_domain_name(source_xml, new_name).ok_or_else(|| {
        LibvirtError::Operation("failed to replace domain name in XML".into())
    })?;
    let new_xml = remove_xml_element(&new_xml, "uuid");
    let new_xml = randomize_mac_addresses(&new_xml);
    let new_xml = replace_disk_path(&new_xml, new_disk_path);
    Domain::define_xml(conn, &new_xml)
        .map_err(|e| LibvirtError::Operation(format!("define cloned VM: {e}")))?;
    Ok(())
}

fn replace_domain_name(xml: &str, new_name: &str) -> Option<String> {
    let start = xml.find("<name>")?;
    let end = xml.find("</name>")?;
    let before = &xml[..start];
    let after = &xml[end + "</name>".len()..];
    Some(format!("{before}<name>{new_name}</name>{after}"))
}

fn remove_xml_element(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    if let Some(start) = xml.find(&open) {
        if let Some(end_offset) = xml[start..].find(&close) {
            let end = start + end_offset + close.len();
            let after = &xml[end..];
            let trim_end = after.len() - after.trim_start().len();
            let mut result = xml[..start].to_string();
            result.push_str(&xml[end + trim_end..]);
            return result;
        }
    }
    xml.to_string()
}

fn randomize_mac_addresses(xml: &str) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut result = String::new();
    let mut remaining = xml;
    let mut counter: u64 = 0;

    while let Some(pos) = remaining.find("<mac ") {
        result.push_str(&remaining[..pos]);
        let tag_start = &remaining[pos..];
        if let Some(end) = tag_start.find("/>") {
            let s1 = RandomState::new();
            let s2 = RandomState::new();
            let mut h1 = s1.build_hasher();
            let mut h2 = s2.build_hasher();
            h1.write_u64(counter);
            h2.write_u64(counter.wrapping_add(1));
            counter += 1;
            let b1 = h1.finish().to_le_bytes();
            let b2 = h2.finish().to_le_bytes();
            let mac = format!(
                "52:54:00:{:02x}:{:02x}:{:02x}",
                b1[0] ^ b2[1],
                b1[2] ^ b2[3],
                b1[4] ^ b2[5]
            );
            result.push_str(&format!("<mac address='{mac}'/>"));
            remaining = &remaining[pos + end + 2..];
        } else if let Some(end) = tag_start.find('>') {
            let s1 = RandomState::new();
            let s2 = RandomState::new();
            let mut h1 = s1.build_hasher();
            let mut h2 = s2.build_hasher();
            h1.write_u64(counter);
            h2.write_u64(counter.wrapping_add(1));
            counter += 1;
            let b1 = h1.finish().to_le_bytes();
            let b2 = h2.finish().to_le_bytes();
            let mac = format!(
                "52:54:00:{:02x}:{:02x}:{:02x}",
                b1[0] ^ b2[1],
                b1[2] ^ b2[3],
                b1[4] ^ b2[5]
            );
            result.push_str(&format!("<mac address='{mac}'/>"));
            remaining = &remaining[pos + end + 1..];
        } else {
            result.push_str(tag_start);
            remaining = "";
        }
    }
    result.push_str(remaining);
    result
}

fn replace_disk_path(xml: &str, new_path: &str) -> String {
    let mut out = String::new();
    let mut replaced = false;
    for line in xml.lines() {
        let t = line.trim();
        if !replaced && t.starts_with("<source file='") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            out.push_str(&format!("{indent}<source file='{new_path}'/>\n"));
            replaced = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn maybe_cloud_init_iso(
    vm: &VirtualMachine,
    cloud: &CloudInitParams,
    images_dir: &str,
) -> Result<Option<String>, LibvirtError> {
    if vm.spec.cloud_init.is_none() && cloud.user.is_empty() {
        return Ok(None);
    }
    let ci = vm.spec.cloud_init.as_ref();
    let user = ci.map(|c| c.user.as_str()).unwrap_or(cloud.user.as_str());
    let pass = ci
        .and_then(|c| c.password.as_deref())
        .unwrap_or(cloud.password.as_str());
    let key = ci
        .and_then(|c| c.ssh_pubkey.as_deref())
        .unwrap_or(cloud.ssh_pubkey.as_str());
    Ok(Some(machina_core::libvirt::extras::generate_cloud_init_iso(
        "",
        images_dir,
        &vm.metadata.name,
        user,
        pass,
        key,
    )?))
}

fn create_linked_clone(backing: &str, path: &str) -> Result<(), LibvirtError> {
    if !Path::new(backing).exists() {
        return Err(LibvirtError::NotFound(format!("template disk: {backing}")));
    }
    let status = Command::new("qemu-img")
        .args(["create", "-f", "qcow2", "-b", backing, "-F", "qcow2", path])
        .status()
        .map_err(|e| LibvirtError::Operation(format!("qemu-img: {e}")))?;
    if !status.success() {
        return Err(LibvirtError::Operation("qemu-img linked clone failed".into()));
    }
    Ok(())
}

fn create_qcow2(path: &str, size_gib: u64) -> Result<(), LibvirtError> {
    let status = Command::new("qemu-img")
        .args(["create", "-f", "qcow2", path, &format!("{size_gib}G")])
        .status()
        .map_err(|e| LibvirtError::Operation(format!("qemu-img: {e}")))?;
    if !status.success() {
        return Err(LibvirtError::Operation("qemu-img create failed".into()));
    }
    Ok(())
}

fn parse_cpu_model(caps: &str) -> Option<String> {
    for line in caps.lines() {
        let t = line.trim();
        if t.starts_with("<model>") {
            return t
                .trim_start_matches("<model>")
                .trim_end_matches("</model>")
                .split_whitespace()
                .next()
                .map(str::to_string);
        }
    }
    None
}

fn parse_domain_cpu(xml: &str) -> Option<String> {
    if let Some(start) = xml.find("<cpu") {
        if let Some(model_start) = xml[start..].find("model='") {
            let rest = &xml[start + model_start + 7..];
            return rest.split('\'').next().map(str::to_string);
        }
    }
    None
}

fn cpu_compatible(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
        || (a.contains("EPYC") && b.contains("EPYC"))
        || (a.contains("Xeon") && b.contains("Xeon"))
        || (a.contains("Core") && b.contains("Core"))
}

fn libvirt_version_major(v: &str) -> u32 {
    v.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0)
}

fn qemu_version_from_path() -> String {
    for bin in [
        "/usr/libexec/qemu-kvm",
        "/usr/bin/qemu-system-x86_64",
        "/usr/bin/qemu-kvm",
    ] {
        if !std::path::Path::new(bin).is_file() {
            continue;
        }
        if let Ok(o) = Command::new(bin).arg("--version").output() {
            let line = String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .to_string();
            if !line.is_empty() {
                return line;
            }
        }
    }
    String::new()
}
