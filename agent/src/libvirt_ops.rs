// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::path::Path;
use std::process::Command;

use machina_core::config::VmCreateBackend;
use machina_core::libvirt::create;
use machina_core::libvirt::domain;
use machina_core::state::CreateVmRequest;
use machina_core::LibvirtError;
use machina_spec::VirtualMachine;
use machina_translate::domain_xml_from_spec;
use virt::connect::Connect;
use virt::domain::Domain;
use virt::sys;

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
    pub guest_ip: String,
}

pub struct LibvirtCtx {
    uri: String,
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
        Ok(Self {
            uri: uri.to_string(),
            conn,
        })
    }

    /// Re-open libvirt when the XML-RPC socket goes stale (common after libvirtd restart).
    pub fn ensure_alive(&mut self) -> Result<(), LibvirtError> {
        if self.conn.is_alive().unwrap_or(false) {
            return Ok(());
        }
        tracing::warn!(
            "machina-agent: libvirt connection stale, reconnecting to {}",
            self.uri
        );
        let _ = self.conn.close();
        self.conn = Connect::open(Some(&self.uri)).map_err(|e| {
            LibvirtError::Connection(format!("libvirt reconnect {}: {e}", self.uri))
        })?;
        Ok(())
    }

    pub fn list_vms(&mut self) -> Result<Vec<VmListEntry>, LibvirtError> {
        self.ensure_alive()?;
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
                    guest_ip: v.guest_ip.clone().unwrap_or_default(),
                };
                if let Ok(dom) = Domain::lookup_by_name(&self.conn, &v.name) {
                    if let Ok(uuid) = dom.get_uuid_string() {
                        entry.uuid = uuid;
                    }
                }
                if running {
                    if let Ok(m) =
                        machina_core::libvirt::metrics::get_vm_metrics(&self.conn, &v.name)
                    {
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

    pub fn list_host_gpus(
        &self,
    ) -> Result<Vec<(String, String, String, u32, String)>, LibvirtError> {
        use machina_core::libvirt::extras::list_iommu_groups;
        let mut out = Vec::new();
        for group in list_iommu_groups()? {
            for dev in &group.devices {
                let name_lower = dev.device_name.to_ascii_lowercase();
                let is_gpu = name_lower.contains("vga")
                    || name_lower.contains("3d")
                    || name_lower.contains("nvidia")
                    || name_lower.contains("gpu")
                    || dev.vendor.to_ascii_lowercase().contains("nvidia");
                if is_gpu {
                    out.push((
                        dev.bdf.clone(),
                        dev.vendor.clone(),
                        dev.device_name.clone(),
                        group.group_id,
                        String::new(),
                    ));
                }
            }
        }
        if let Ok(out_smi) = std::process::Command::new("nvidia-smi")
            .args([
                "--query-gpu=pci.bus_id,name,mig.mode.current",
                "--format=csv,noheader",
            ])
            .output()
        {
            if out_smi.status.success() {
                let text = String::from_utf8_lossy(&out_smi.stdout);
                for line in text.lines() {
                    let parts: Vec<_> = line.split(',').map(|s| s.trim().to_string()).collect();
                    if parts.len() >= 2 {
                        let pci = parts[0].replace("00000000:", "").to_ascii_lowercase();
                        let mig = parts.get(2).cloned().unwrap_or_default();
                        for entry in &mut out {
                            if entry.0.to_ascii_lowercase().contains(&pci) || pci.contains(&entry.0)
                            {
                                entry.4 = mig.clone();
                            }
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    pub fn list_storage_pools(
        &self,
    ) -> Result<Vec<(machina_core::StoragePoolInfo, String, String)>, LibvirtError> {
        use machina_core::libvirt::storage::{
            list_pools, storage_pool_backend_from_xml, target_path_from_pool_xml,
        };
        use virt::storage_pool::StoragePool;

        let pools = list_pools(&self.conn)?;
        let mut out = Vec::with_capacity(pools.len());
        for info in pools {
            let (path, backend) = StoragePool::lookup_by_name(&self.conn, &info.name)
                .ok()
                .and_then(|p| p.get_xml_desc(0).ok())
                .map(|xml| {
                    (
                        target_path_from_pool_xml(&xml).unwrap_or_default(),
                        storage_pool_backend_from_xml(&xml),
                    )
                })
                .unwrap_or_else(|| (String::new(), "directory".into()));
            out.push((info, path, backend));
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
        // Confine the caller-supplied disk_path to a configured storage pool before we
        // create — or (for a stale leftover) remove — any file at it. Without this a
        // crafted disk_path could make the agent delete/overwrite an arbitrary root file.
        machina_core::libvirt::storage::assert_new_disk_output_parent_allowed(
            &self.conn, disk_path,
        )?;
        let tmpl = template_source.filter(|s| !s.is_empty());
        if !Path::new(disk_path).exists() {
            if let Some(src) = tmpl {
                create_disk_from_template(src, disk_path)?;
            } else {
                let size_gib = vm
                    .root_disk_gib()
                    .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
                create_qcow2(disk_path, size_gib)?;
            }
        } else if let Some(src) = tmpl {
            // A disk already exists at this path AND a template was requested. The disk
            // path is keyed on VM name, and VM deletion keeps disks by default, so when
            // NO domain by this name exists the file is a stale leftover from a prior,
            // deleted VM — reusing it would boot another VM's OS and data (cross-VM
            // leak). Rebuild it from the requested template. When the domain DOES exist
            // this is a reconcile of a live VM: never touch the disk (would wipe data).
            if Domain::lookup_by_name(&self.conn, &vm.metadata.name).is_err() {
                std::fs::remove_file(disk_path).map_err(|e| {
                    LibvirtError::Operation(format!("remove stale disk {disk_path}: {e}"))
                })?;
                create_disk_from_template(src, disk_path)?;
            }
        }
        // An existing disk of a live (already-defined) VM is its real, self-contained
        // disk — reused as-is above. Template disks are full copies (see
        // create_disk_from_template), so there is no backing chain to reconcile.

        let cloud_iso = maybe_cloud_init_iso(vm, cloud, images_dir)?;

        if vm_uses_virt_install(vm) {
            let req = create_request_from_vm(vm, disk_path, cloud_iso.as_deref())?;
            let cfg = machina_core::config::MachinaConfig::load();
            let uri = self
                .conn
                .get_uri()
                .map_err(|e| LibvirtError::Operation(format!("libvirt URI: {e}")))?;
            create::create_vm(
                &self.conn,
                &req,
                VmCreateBackend::VirtInstall,
                &uri,
                &cfg.libvirt,
                None,
            )?;
            let dom = Domain::lookup_by_name(&self.conn, &vm.metadata.name)
                .map_err(|e| LibvirtError::Operation(format!("lookup VM: {e}")))?;
            let uuid = dom
                .get_uuid_string()
                .map_err(|e| LibvirtError::Operation(e.to_string()))?;
            return Ok((vm.metadata.name.clone(), uuid));
        }

        machina_core::libvirt::guest_agent_provision::inject_guestkit_into_disk(
            disk_path, None, None,
        )?;

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
        // SECURITY: the shell template is pinned to the admin-configured, trusted
        // `MACHINA_FENCE_COMMAND` and is NEVER taken from the request. The agent gRPC
        // surface may be unauthenticated, so accepting a request-supplied shell string
        // here was a direct root-command-execution primitive (a metacharacter blocklist
        // does not help: the request string *is* the command, so space-separated args
        // like `install -m4755 /bin/sh …` need no metacharacters). A request that still
        // carries `shell_command` is rejected rather than silently ignored.
        if !shell_command.is_empty() {
            return Err(LibvirtError::Operation(
                "request-supplied fence shell_command is not permitted; \
                 fencing uses the operator-configured MACHINA_FENCE_COMMAND only"
                    .into(),
            ));
        }
        let template = std::env::var("MACHINA_FENCE_COMMAND").unwrap_or_default();
        if template.is_empty() {
            return Err(LibvirtError::Operation(
                "MACHINA_FENCE_COMMAND not configured".into(),
            ));
        }
        if !hostname.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') {
            return Err(LibvirtError::Operation(format!(
                "invalid hostname for fence: {hostname}"
            )));
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
        // Pass the IPMI password via the IPMI_PASSWORD env var (`-E`) instead of `-P`
        // on argv, which would expose it to any local user via `ps`/`/proc/<pid>/cmdline`.
        let output = Command::new("ipmitool")
            .args([
                "-I", "lanplus", "-H", address, "-U", user, "-E", "power", "off",
            ])
            .env("IPMI_PASSWORD", pass)
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

    pub fn power(
        &self,
        name: &str,
        action: &str,
        mode: Option<&str>,
    ) -> Result<String, LibvirtError> {
        use machina_core::libvirt::domain::PowerMode;
        let power_mode = mode.map(PowerMode::parse).unwrap_or_default();
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        let active = dom.is_active().unwrap_or(false);
        match action {
            "start" => {
                if !active {
                    dom.create()
                        .map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            "stop" => {
                if active {
                    dom.destroy()
                        .map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            "reboot" => {
                if active {
                    domain::reboot_vm_mode(&self.conn, name, power_mode)?;
                } else {
                    dom.create()
                        .map_err(|e| LibvirtError::Operation(e.to_string()))?;
                }
            }
            "reset" => {
                if !active {
                    return Err(LibvirtError::Invalid(
                        "force reboot (reset) requires a running guest".into(),
                    ));
                }
                domain::reset_vm(&self.conn, name)?;
            }
            "shutdown" => {
                if active {
                    domain::shutdown_vm_mode(&self.conn, name, power_mode)?;
                }
            }
            "pause" => {
                if active {
                    domain::pause_vm(&self.conn, name)?;
                }
            }
            "resume" => {
                domain::resume_vm(&self.conn, name)?;
            }
            _ => {
                return Err(LibvirtError::Invalid(format!(
                    "unknown power action: {action}"
                )))
            }
        }
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        let info = dom
            .get_info()
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        Ok(machina_core::libvirt::metrics::domain_state_label(info.state).to_string())
    }

    pub fn get_domain_xml(&self, name: &str) -> Result<String, LibvirtError> {
        let dom = Domain::lookup_by_name(&self.conn, name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{name}': {e}")))?;
        dom.get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))
    }

    pub fn delete(&self, name: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::domain::delete_vm(&self.conn, name)
    }

    pub fn get_vm_details(
        &self,
        name: &str,
    ) -> Result<machina_core::state::VmDetails, LibvirtError> {
        machina_core::libvirt::domain::get_vm_details(&self.conn, name)
    }

    /// Start virt-install on a define-only guest using install metadata from the Machina spec.
    pub fn install_defined_from_spec(
        &self,
        vm: &machina_spec::VirtualMachine,
    ) -> Result<(), LibvirtError> {
        let name = &vm.metadata.name;
        let xml = self.get_domain_xml(name)?;
        let disk_path = machina_core::libvirt::template_apply::primary_disk_path_from_xml(&xml)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut req = create_request_from_vm(vm, &disk_path, None)?;
        req.virt_install_define_only = false;
        let uri = self
            .conn
            .get_uri()
            .map_err(|e| LibvirtError::Operation(format!("libvirt URI: {e}")))?;
        machina_core::libvirt::virt_install::install_defined_vm(&self.conn, &uri, &req, None)
    }

    pub fn detach_disk(&self, vm_name: &str, target_dev: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::device::detach_disk(&self.conn, vm_name, target_dev)
    }

    pub fn resize_disk(
        &self,
        vm_name: &str,
        target_dev: &str,
        size_gb: u64,
    ) -> Result<(), LibvirtError> {
        machina_core::libvirt::device::resize_block_device(&self.conn, vm_name, target_dev, size_gb)
    }

    pub fn attach_nic(
        &self,
        vm_name: &str,
        network: &str,
        model: &str,
    ) -> Result<(), LibvirtError> {
        machina_core::libvirt::device::attach_interface(&self.conn, vm_name, network, model)
    }

    pub fn detach_nic(&self, vm_name: &str, mac: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::device::detach_interface(&self.conn, vm_name, mac)
    }

    pub fn set_autostart(&self, name: &str, enabled: bool) -> Result<(), LibvirtError> {
        machina_core::libvirt::domain::set_autostart(&self.conn, name, enabled)
    }

    pub fn set_vcpus(&self, name: &str, count: u32) -> Result<(), LibvirtError> {
        machina_core::libvirt::resize::set_vcpus(&self.conn, name, count)
    }

    pub fn set_memory(&self, name: &str, memory_mb: u64) -> Result<(), LibvirtError> {
        machina_core::libvirt::resize::set_memory(&self.conn, name, memory_mb)
    }

    pub fn resolve_vnc_from_xml(&self, name: &str, xml: &str) -> Result<(String, u16), LibvirtError> {
        machina_core::libvirt::vnc::resolve_vnc_tcp_xml(&self.conn, name, xml)
    }

    pub fn resolve_vnc(&mut self, name: &str) -> Result<(String, u16), LibvirtError> {
        self.ensure_alive()?;
        machina_core::libvirt::vnc::resolve_vnc_tcp(&self.conn, name)
    }

    pub fn migrate(
        &self,
        name: &str,
        dest_uri: &str,
        live: bool,
        bandwidth_mib: u64,
        postcopy: bool,
        undefine_source: bool,
        tunnelled: bool,
        migrate_disks: Vec<String>,
        disks_uri: Option<String>,
        copy_storage: bool,
    ) -> Result<(), LibvirtError> {
        if bandwidth_mib > 0 {
            machina_core::libvirt::migrate::migrate_set_max_speed(&self.conn, name, bandwidth_mib)?;
        }
        let mut extra_flags = 0u32;
        if postcopy {
            extra_flags |= sys::VIR_MIGRATE_POSTCOPY;
        }
        if undefine_source {
            extra_flags |= sys::VIR_MIGRATE_UNDEFINE_SOURCE;
        }
        if tunnelled {
            extra_flags |= sys::VIR_MIGRATE_TUNNELLED;
        }
        if copy_storage {
            extra_flags |= sys::VIR_MIGRATE_NON_SHARED_DISK;
        }
        let extra = if migrate_disks.is_empty() && disks_uri.is_none() {
            None
        } else {
            Some(machina_core::libvirt::migrate::MigrateParametersApi {
                migrate_disks,
                disks_uri,
                ..Default::default()
            })
        };
        machina_core::libvirt::migrate::migrate_vm_uri(
            &self.conn,
            name,
            dest_uri,
            live,
            extra.as_ref(),
            extra_flags,
        )
    }

    pub fn clone_vm(
        &self,
        source: &str,
        new_name: &str,
        clone_mode: &str,
    ) -> Result<String, LibvirtError> {
        machina_core::libvirt::clone::clone_vm_with_disk(&self.conn, source, new_name, clone_mode)
    }

    pub fn create_snapshot(
        &self,
        vm_name: &str,
        snap_name: &str,
        description: &str,
        disk_only: bool,
        quiesce: bool,
        storage_mode: &str,
    ) -> Result<(), LibvirtError> {
        let req = machina_core::state::CreateSnapshotRequest {
            name: snap_name.to_string(),
            description: description.to_string(),
            disk_only,
            storage_mode: storage_mode.to_string(),
            memory_snapshot: String::new(),
            memory_file: String::new(),
            external_disk_dir: String::new(),
            external_memory_dir: String::new(),
            disks: Vec::new(),
            atomic: true,
            reuse_external: false,
            quiesce,
        };
        machina_core::libvirt::snapshot::create_snapshot(&self.conn, vm_name, &req)
    }

    pub fn delete_snapshot(&self, vm_name: &str, snap_name: &str) -> Result<(), LibvirtError> {
        machina_core::libvirt::snapshot::delete_snapshot(&self.conn, vm_name, snap_name)
    }

    pub fn list_snapshots(
        &self,
        vm_name: &str,
    ) -> Result<Vec<(String, String, i64, bool)>, LibvirtError> {
        Ok(
            machina_core::libvirt::snapshot::list_snapshots(&self.conn, vm_name)?
                .into_iter()
                .map(|s| (s.name, s.state, s.creation_time, s.is_current))
                .collect(),
        )
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
        machina_spec::validate_name(new_name).map_err(|e| LibvirtError::Invalid(e.to_string()))?;

        // SECURITY: `new_disk_path` is a request-controlled overwrite target on an
        // unauthenticated gRPC surface. Confine it to the agent's allowed storage
        // directories (rejecting `..` / escapes) so a caller cannot write the cloned
        // disk to an arbitrary host path as root. Only relevant to the qemu-img path
        // below; the revert-source branch clones via libvirt into a pool.
        if !revert_source {
            machina_core::libvirt::storage::assert_new_disk_output_parent_allowed(
                &self.conn,
                new_disk_path,
            )?;
        }

        if revert_source {
            self.revert_snapshot(vm_name, snap_name)?;
            let _uuid = self.clone_vm(vm_name, new_name, "full")?;
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
        // SECURITY: `backup_path` is a request-controlled read source on an
        // unauthenticated gRPC surface. Confine it to the agent's allowed storage
        // directories so a caller cannot read arbitrary host files into a VM disk.
        machina_core::libvirt::storage::assert_backup_source_within_pools(
            &self.conn,
            backup_path,
        )?;
        let dom = Domain::lookup_by_name(&self.conn, vm_name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
        let was_running = dom.is_active().unwrap_or(false);
        if was_running {
            dom.destroy()
                .map_err(|e| LibvirtError::Operation(format!("stop for restore: {e}")))?;
        }
        let result = (|| -> Result<(), LibvirtError> {
            let xml = dom
                .get_xml_desc(0)
                .map_err(|e| LibvirtError::Operation(e.to_string()))?;
            let disks = count_data_disks(&xml);
            if disks > 1 {
                return Err(LibvirtError::Operation(format!(
                    "VM '{vm_name}' has {disks} data disks; multi-disk restore is not supported \
                     (restoring only the first disk would leave the others stale). Refusing."
                )));
            }
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
            Ok(())
        })();
        // Restart whether or not the restore succeeded, so a failed restore (e.g.
        // qemu-img error) doesn't leave a previously-running guest powered off.
        if was_running {
            if let Err(e) = dom.create() {
                // Only surface the restart error when the restore itself succeeded.
                if result.is_ok() {
                    return Err(LibvirtError::Operation(format!("start after restore: {e}")));
                }
            }
        }
        result
    }

    pub fn backup_vm_disk(&self, vm_name: &str, dest_path: &str) -> Result<String, LibvirtError> {
        // SECURITY: `dest_path` is a request-controlled overwrite target on an
        // unauthenticated gRPC surface. Confine it to the agent's allowed storage
        // directories (rejecting `..` / escapes) so a caller cannot overwrite
        // arbitrary host files as root.
        machina_core::libvirt::storage::assert_new_disk_output_parent_allowed(
            &self.conn, dest_path,
        )?;
        let dom = Domain::lookup_by_name(&self.conn, vm_name)
            .map_err(|e| LibvirtError::NotFound(format!("VM '{vm_name}': {e}")))?;
        let xml = dom
            .get_xml_desc(0)
            .map_err(|e| LibvirtError::Operation(e.to_string()))?;
        let disks = count_data_disks(&xml);
        if disks > 1 {
            return Err(LibvirtError::Operation(format!(
                "VM '{vm_name}' has {disks} data disks; multi-disk backup is not supported \
                 (backing up only the first disk would silently lose the others). Refusing."
            )));
        }
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

    pub fn attach_disk(
        &self,
        vm_name: &str,
        disk_path: &str,
        target_dev: &str,
    ) -> Result<(), LibvirtError> {
        use std::process::Command;
        // Confine the attached source to a configured pool so a caller can't attach an
        // arbitrary host file/block device (e.g. /dev/sda, /etc/shadow) into a guest and
        // read it out via the console.
        machina_core::libvirt::storage::assert_backup_source_within_pools(&self.conn, disk_path)?;
        if !std::path::Path::new(disk_path).exists() {
            return Err(LibvirtError::NotFound(format!(
                "disk not found: {disk_path}"
            )));
        }
        // Hot-plug on a running domain: without --live the disk is only written to
        // persistent config (visible after reboot) while the op reports success,
        // so callers wrongly believe it was live-attached.
        let running = Domain::lookup_by_name(&self.conn, vm_name)
            .ok()
            .and_then(|d| d.is_active().ok())
            .unwrap_or(false);
        let mut args = vec![
            "attach-disk",
            vm_name,
            disk_path,
            target_dev,
            "--config",
            "--persistent",
        ];
        if running {
            args.push("--live");
        }
        let out = Command::new("virsh")
            .args(&args)
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
            .and_then(|g| {
                g.ip_addresses
                    .iter()
                    .find(|ip| ip.ip_type == "ipv4" && !ip.address.starts_with("127."))
                    .map(|ip| ip.address.clone())
            })
            .unwrap_or_default();
        let guest_hostname = report
            .guest
            .as_ref()
            .map(|g| g.hostname.clone())
            .unwrap_or_default();
        let diagnostics_json = report
            .diagnostics
            .as_ref()
            .and_then(|d| serde_json::to_string(d).ok())
            .unwrap_or_default();
        let (install_state, channel_attached, channel_connected, agent_ping, agent_version) =
            report
                .diagnostics
                .as_ref()
                .map(|d| {
                    (
                        d.install_state.clone(),
                        d.channel_attached,
                        d.channel_connected,
                        d.agent_ping,
                        d.agent_version.clone().unwrap_or_default(),
                    )
                })
                .unwrap_or(("unknown".into(), false, false, false, String::new()));
        Ok(GuestHealthSummary {
            state: report.state,
            agent_reachable: report.agent_reachable,
            healthy: report.healthy,
            os_pretty_name: report.os_pretty_name.unwrap_or_default(),
            guest_ip,
            guest_hostname,
            issues: report.issues,
            install_state,
            channel_attached,
            channel_connected,
            agent_ping,
            agent_version,
            diagnostics_json,
        })
    }

    pub fn guest_observability(&self, name: &str) -> Result<String, LibvirtError> {
        let info = machina_core::libvirt::guest_agent::get_guest_observability(&self.conn, name)?;
        serde_json::to_string(&info)
            .map_err(|e| LibvirtError::Internal(format!("serialize guest observability: {e}")))
    }

    pub fn guest_agent_action(&self, name: &str, action: &str) -> Result<String, LibvirtError> {
        let result = machina_core::libvirt::guest_agent_actions::run_guest_agent_action(
            &self.conn, name, action,
        )?;
        serde_json::to_string(&result)
            .map_err(|e| LibvirtError::Internal(format!("serialize guest action: {e}")))
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
    pub install_state: String,
    pub channel_attached: bool,
    pub channel_connected: bool,
    pub agent_ping: bool,
    pub agent_version: String,
    pub diagnostics_json: String,
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

/// Count file-backed *data* disks (device='disk'), ignoring cdrom/floppy. Backup
/// and restore only handle the first disk (`extract_disk_path`); if a VM has more,
/// silently touching only disk 1 loses/leaves-stale every other disk's data. We
/// use this to FAIL LOUDLY on multi-disk VMs instead of producing a backup that
/// looks successful but is missing data.
fn count_data_disks(xml: &str) -> usize {
    xml.matches("device='disk'").count() + xml.matches("device=\"disk\"").count()
}

fn define_cloned_domain(
    conn: &Connect,
    source_xml: &str,
    new_name: &str,
    new_disk_path: &str,
) -> Result<(), LibvirtError> {
    let new_xml = replace_domain_name(source_xml, new_name)
        .ok_or_else(|| LibvirtError::Operation("failed to replace domain name in XML".into()))?;
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
    // Escape the path — a filename may legally contain ' < > & on Linux, which
    // would otherwise break out of the file='…' attribute and inject arbitrary
    // devices into a root-defined domain. Mirrors core::libvirt::clone.
    let escaped = machina_core::xml::escape(new_path);
    let mut out = String::new();
    let mut replaced = false;
    for line in xml.lines() {
        let t = line.trim();
        if !replaced && t.starts_with("<source file='") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            out.push_str(&format!("{indent}<source file='{escaped}'/>\n"));
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
    let guest_default = machina_core::libvirt::guest_agent_provision::guest_agent_enabled(None);
    if vm.spec.cloud_init.is_none() && cloud.user.is_empty() && !guest_default {
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
    Ok(Some(
        machina_core::libvirt::extras::generate_cloud_init_iso(
            "",
            images_dir,
            &vm.metadata.name,
            user,
            pass,
            key,
            None,
        )?,
    ))
}

/// Provision a VM root disk from a template as a **full, self-contained copy**
/// (`qemu-img convert`), not a copy-on-write overlay backed by the shared template
/// image. A COW linked clone produces a multi-level backing chain once the VM is
/// snapshotted (overlay → vm-disk → template-base); libvirt only records the
/// backing chain one level deep, so virt-aa-helper omits the template base from the
/// VM's AppArmor profile and qemu is denied reading it on restart ("Could not open
/// <base>.qcow2: Permission denied"). A full copy has no external backing, so the
/// snapshot chain is at most overlay → vm-disk and always fully authorized.
/// Trade-off: each VM consumes the base's full allocated size and creation copies
/// the base rather than linking it.
fn create_disk_from_template(template: &str, path: &str) -> Result<(), LibvirtError> {
    if !Path::new(template).exists() {
        return Err(LibvirtError::NotFound(format!("template disk: {template}")));
    }
    // -c compresses the copied base clusters, cutting the on-disk cost of a full
    // per-VM copy (guest writes land uncompressed). Matches the daemon template path.
    let status = Command::new("qemu-img")
        .args(["convert", "-O", "qcow2", "-c", template, path])
        .status()
        .map_err(|e| LibvirtError::Operation(format!("qemu-img: {e}")))?;
    if !status.success() {
        return Err(LibvirtError::Operation(
            "qemu-img convert from template failed".into(),
        ));
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
    // Locate the real <cpu> element. Require the char after "<cpu" to be a tag
    // delimiter so we don't match <cputune>/<cpuset>, and confine the model search
    // to the <cpu>…</cpu> span so we don't pick up an unrelated device's
    // model='…' (e.g. <tpm model='tpm-crb'>, <memballoon model='virtio'>).
    let mut search = 0;
    let cpu_open = loop {
        let rel = xml[search..].find("<cpu")?;
        let abs = search + rel;
        match xml[abs + 4..].chars().next() {
            Some(' ' | '>' | '\n' | '\t' | '\r' | '/') => break abs,
            _ => search = abs + 4,
        }
    };
    let gt = xml[cpu_open..].find('>')? + cpu_open;
    let open_tag = &xml[cpu_open..gt];
    let span_end = xml[gt..].find("</cpu>").map(|e| gt + e).unwrap_or(gt);
    let inner = &xml[gt..span_end];

    // Preferred form: <model fallback='allow'>Skylake-Client-IBRS</model> child.
    if let Some(ms) = inner.find("<model") {
        let rest = &inner[ms..];
        if let Some(tag_end) = rest.find('>') {
            let after = &rest[tag_end + 1..];
            if let Some(close) = after.find("</model>") {
                let text = after[..close].trim();
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    // Fallback: model='…' / model="…" attribute on the <cpu> open tag itself.
    for (pat, quote) in [("model='", '\''), ("model=\"", '"')] {
        if let Some(attr) = open_tag.find(pat) {
            let rest = &open_tag[attr + pat.len()..];
            let val = rest.split(quote).next().unwrap_or("");
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    // host-passthrough / host-model with no explicit model → no comparable name.
    None
}

fn cpu_compatible(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
        || (a.contains("EPYC") && b.contains("EPYC"))
        || (a.contains("Xeon") && b.contains("Xeon"))
        || (a.contains("Core") && b.contains("Core"))
}

fn libvirt_version_major(v: &str) -> u32 {
    v.split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
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

fn label_bool(labels: &std::collections::HashMap<String, String>, key: &str) -> bool {
    labels
        .get(key)
        .is_some_and(|v| v == "true" || v == "1" || v.eq_ignore_ascii_case("yes"))
}

fn label_str<'a>(labels: &'a std::collections::HashMap<String, String>, key: &str) -> &'a str {
    labels.get(key).map(|s| s.as_str()).unwrap_or("")
}

fn vm_uses_virt_install(vm: &VirtualMachine) -> bool {
    let Some(labels) = vm.metadata.labels.as_ref() else {
        return false;
    };
    !label_str(labels, "virt_install_location").trim().is_empty()
        || label_bool(labels, "virt_install_pxe")
        || !label_str(labels, "virt_install_install_os")
            .trim()
            .is_empty()
        || label_bool(labels, "virt_install_define_only")
}

fn create_request_from_vm(
    vm: &VirtualMachine,
    disk_path: &str,
    cloud_init_iso: Option<&str>,
) -> Result<CreateVmRequest, LibvirtError> {
    vm.validate()
        .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
    let labels = vm.metadata.labels.clone().unwrap_or_default();
    let network = vm
        .spec
        .network
        .first()
        .map(|n| n.network.clone())
        .unwrap_or_else(|| "default".into());
    let memory_mb = vm
        .memory_mib()
        .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
    let disk_gb = vm
        .root_disk_gib()
        .map_err(|e| LibvirtError::Invalid(e.to_string()))?;
    let iso = label_str(&labels, "install_iso").trim().to_string();
    let os_variant = label_str(&labels, "os_variant").trim().to_string();
    let mut req = CreateVmRequest {
        name: vm.metadata.name.clone(),
        vcpus: vm.total_vcpus(),
        memory_mb,
        disk_gb,
        iso,
        network,
        os_variant: if os_variant.is_empty() {
            "generic".into()
        } else {
            os_variant
        },
        firmware: vm.spec.firmware.clone(),
        graphics_listen: vm.spec.graphics.listen.clone(),
        graphics_type: vm.spec.graphics.r#type.clone(),
        create_backend: "virt_install".into(),
        virt_install_location: label_str(&labels, "virt_install_location")
            .trim()
            .to_string(),
        virt_install_pxe: label_bool(&labels, "virt_install_pxe"),
        virt_install_pxe_network: label_str(&labels, "virt_install_pxe_network")
            .trim()
            .to_string(),
        virt_install_install_os: label_str(&labels, "virt_install_install_os")
            .trim()
            .to_string(),
        virt_install_extra_args: label_str(&labels, "virt_install_extra_args")
            .trim()
            .to_string(),
        virt_install_define_only: label_bool(&labels, "virt_install_define_only"),
        virt_install_path_in_use_check_off: label_bool(
            &labels,
            "virt_install_path_in_use_check_off",
        ) || !disk_path.trim().is_empty(),
        root_disk_storage_pool: label_str(&labels, "root_disk_storage_pool")
            .trim()
            .to_string(),
        root_disk_storage_volume: label_str(&labels, "root_disk_storage_volume")
            .trim()
            .to_string(),
        virt_install_disk_backing_store: label_str(&labels, "virt_install_disk_backing_store")
            .trim()
            .to_string(),
        virt_install_unattended: label_bool(&labels, "virt_install_unattended"),
        virt_install_admin_password: label_str(&labels, "virt_install_admin_password")
            .trim()
            .to_string(),
        virt_install_user_login: label_str(&labels, "virt_install_user_login")
            .trim()
            .to_string(),
        virt_install_user_password: label_str(&labels, "virt_install_user_password")
            .trim()
            .to_string(),
        ..Default::default()
    };
    if let Some(ci) = vm.spec.cloud_init.as_ref() {
        req.cloud_init_user = ci.user.clone();
        if let Some(p) = ci.password.as_deref() {
            req.cloud_init_password = p.to_string();
        }
        if let Some(k) = ci.ssh_pubkey.as_deref() {
            req.cloud_init_ssh_pubkey = k.to_string();
        }
    }
    if let Some(path) = cloud_init_iso.filter(|p| !p.is_empty()) {
        req.cloud_init_iso = path.to_string();
    }
    if !label_str(&labels, "existing_disk").trim().is_empty() {
        req.existing_disk = label_str(&labels, "existing_disk").trim().to_string();
    }
    if !disk_path.trim().is_empty() && Path::new(disk_path).exists() {
        req.existing_disk = disk_path.trim().to_string();
    }
    let virtio_win_iso = label_str(&labels, "virtio_win_iso").trim().to_string();
    if !virtio_win_iso.is_empty() {
        req.virtio_win_iso = virtio_win_iso;
    }
    Ok(req)
}

#[cfg(test)]
mod cpu_parse_tests {
    use super::parse_domain_cpu;

    #[test]
    fn model_child_element() {
        let xml = "<domain><cputune><shares>1024</shares></cputune>\
                   <cpu mode='custom' match='exact'>\
                   <model fallback='allow'>Skylake-Client-IBRS</model>\
                   </cpu>\
                   <devices><tpm model='tpm-crb'/><memballoon model='virtio'/></devices></domain>";
        assert_eq!(parse_domain_cpu(xml).as_deref(), Some("Skylake-Client-IBRS"));
    }

    #[test]
    fn host_passthrough_has_no_model() {
        // No CPU model to compare — must NOT fall through to a device's model=.
        let xml = "<domain><cpu mode='host-passthrough' check='none'/>\
                   <devices><controller model='virtio-scsi'/></devices></domain>";
        assert_eq!(parse_domain_cpu(xml), None);
    }

    #[test]
    fn cputune_prefix_is_not_the_cpu_element() {
        // Only <cputune> present — the old code matched "<cpu" here then grabbed a
        // later device model. There is no real <cpu> element, so expect None.
        let xml = "<domain><cputune><shares>512</shares></cputune>\
                   <devices><tpm model='tpm-crb'/></devices></domain>";
        assert_eq!(parse_domain_cpu(xml), None);
    }

    #[test]
    fn model_attribute_on_cpu_tag() {
        let xml = "<domain><cpu model='EPYC-Rome'/></domain>";
        assert_eq!(parse_domain_cpu(xml).as_deref(), Some("EPYC-Rome"));
    }
}
