use std::sync::Arc;

use machina_spec::VirtualMachine;
use tonic::{Request, Response, Status};

use crate::libvirt_ops;
use crate::pb::host_agent_server::HostAgent;
use crate::pb::*;
use crate::state::SharedAgentState;

pub struct AgentService {
    pub state: SharedAgentState,
    pub libvirt: Arc<std::sync::Mutex<libvirt_ops::LibvirtCtx>>,
}

impl AgentService {
    pub fn new(
        state: SharedAgentState,
        libvirt: Arc<std::sync::Mutex<libvirt_ops::LibvirtCtx>>,
    ) -> Self {
        Self { state, libvirt }
    }

    async fn libvirt_call<T, F>(&self, f: F) -> Result<T, Status>
    where
        F: FnOnce(&libvirt_ops::LibvirtCtx) -> Result<T, machina_core::LibvirtError> + Send + 'static,
        T: Send + 'static,
    {
        let libvirt = self.libvirt.clone();
        tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            f(&ctx)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))
    }
}

#[tonic::async_trait]
impl HostAgent for AgentService {
    async fn register(
        &self,
        request: Request<RegisterRequest>,
    ) -> Result<Response<RegisterResponse>, Status> {
        let req = request.into_inner();
        let mut st = self.state.write().await;
        st.hostname = req.hostname;
        Ok(Response::new(RegisterResponse {
            host_id: st.host_id.clone(),
            accepted: true,
        }))
    }

    async fn heartbeat(
        &self,
        request: Request<HeartbeatRequest>,
    ) -> Result<Response<HeartbeatResponse>, Status> {
        let _ = request.into_inner();
        let st = self.state.read().await;
        let libvirt = self.libvirt.clone();
        let (vms, stats) = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            let vms = ctx.list_vms()?;
            let stats = ctx.host_resource_stats().unwrap_or((0.0, 0, 0));
            Ok::<_, machina_core::LibvirtError>((vms, stats))
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(HeartbeatResponse {
            state: format!("{:?}", st.maintenance).to_ascii_lowercase(),
            vm_count: vms.len() as u32,
            cpu_percent: stats.0,
            memory_used_mib: stats.1,
            memory_total_mib: stats.2,
        }))
    }

    async fn list_vms(
        &self,
        _request: Request<ListVmsRequest>,
    ) -> Result<Response<ListVmsResponse>, Status> {
        let vms = self.libvirt_call(|ctx| {
            ctx.list_vms()        }).await?;
        Ok(Response::new(ListVmsResponse {
            vms: vms
                .into_iter()
                .map(|v| VmSummary {
                    name: v.name,
                    uuid: v.uuid,
                    state: v.state,
                    vcpus: v.vcpus,
                    memory_mb: v.memory_mb,
                    cpu_percent: v.cpu_percent,
                    memory_used_mib: v.memory_used_mib,
                    disk_read_iops: v.disk_read_iops,
                    disk_write_iops: v.disk_write_iops,
                })
                .collect(),
        }))
    }

    async fn list_networks(
        &self,
        _request: Request<ListNetworksRequest>,
    ) -> Result<Response<ListNetworksResponse>, Status> {
        let networks = self.libvirt_call(|ctx| {
            ctx.list_networks()        }).await?;
        Ok(Response::new(ListNetworksResponse {
            networks: networks
                .into_iter()
                .map(|n| NetworkSummary {
                    name: n.name,
                    uuid: n.uuid,
                    active: n.active,
                    persistent: n.persistent,
                    autostart: n.autostart,
                    bridge: n.bridge,
                })
                .collect(),
        }))
    }

    async fn list_storage_pools(
        &self,
        _request: Request<ListStoragePoolsRequest>,
    ) -> Result<Response<ListStoragePoolsResponse>, Status> {
        let pools = self.libvirt_call(|ctx| {
            ctx.list_storage_pools()        }).await?;
        Ok(Response::new(ListStoragePoolsResponse {
            pools: pools
                .into_iter()
                .map(|(p, path)| StoragePoolSummary {
                    name: p.name,
                    uuid: p.uuid,
                    state: p.state,
                    capacity_gib: p.capacity_gb,
                    used_gib: p.allocation_gb,
                    available_gib: p.available_gb,
                    autostart: p.autostart,
                    path,
                })
                .collect(),
        }))
    }

    async fn apply_vm(
        &self,
        request: Request<ApplyVmRequest>,
    ) -> Result<Response<ApplyVmResponse>, Status> {
        let req = request.into_inner();
        let vm: VirtualMachine =
            serde_json::from_str(&req.spec_json).map_err(|e| Status::invalid_argument(e.to_string()))?;
        let libvirt = self.libvirt.clone();
        let disk_path = req.disk_path.clone();
        let template_source = req.template_source.clone();
        let cloud = libvirt_ops::CloudInitParams {
            user: req.cloud_init_user.clone(),
            password: req.cloud_init_password.clone(),
            ssh_pubkey: req.cloud_init_ssh_pubkey.clone(),
        };
        let images_dir = std::path::Path::new(&disk_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/var/lib/libvirt/images")
            .to_string();
        let (name, uuid) = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            let tpl = if template_source.is_empty() {
                None
            } else {
                Some(template_source.as_str())
            };
            ctx.apply_vm(&vm, &disk_path, tpl, &cloud, &images_dir)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(ApplyVmResponse {
            vm_name: name,
            uuid,
            created: true,
        }))
    }

    async fn vm_power(
        &self,
        request: Request<VmPowerRequest>,
    ) -> Result<Response<VmPowerResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let action = req.action.clone();
        let state = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.power(&vm_name, &action)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(VmPowerResponse {
            vm_name: req.vm_name,
            state,
        }))
    }

    async fn delete_vm(
        &self,
        request: Request<DeleteVmRequest>,
    ) -> Result<Response<DeleteVmResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.delete(&vm_name)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(DeleteVmResponse { deleted: true }))
    }

    async fn migrate_vm(
        &self,
        request: Request<MigrateVmRequest>,
    ) -> Result<Response<MigrateVmResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let dest_uri = req.dest_uri.clone();
        let live = req.live;
        tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.migrate(&vm_name, &dest_uri, live)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(MigrateVmResponse {
            ok: true,
            message: "migration complete".into(),
        }))
    }

    async fn get_console(
        &self,
        request: Request<GetConsoleRequest>,
    ) -> Result<Response<GetConsoleResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let (host, port) = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.resolve_vnc(&vm_name)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(GetConsoleResponse {
            console_type: "vnc".into(),
            host,
            port: i32::from(port),
            websocket_port: -1,
        }))
    }

    async fn clone_vm(
        &self,
        request: Request<CloneVmRequest>,
    ) -> Result<Response<CloneVmResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let source = req.source_name.clone();
        let new_name = req.new_name.clone();
        let (vm_name, uuid) = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.clone_vm(&source, &new_name)?;
            let dom = virt::domain::Domain::lookup_by_name(&ctx.conn, &new_name)
                .map_err(|e| machina_core::LibvirtError::Operation(e.to_string()))?;
            let uuid = dom
                .get_uuid_string()
                .map_err(|e| machina_core::LibvirtError::Operation(e.to_string()))?;
            Ok::<_, machina_core::LibvirtError>((new_name, uuid))
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(CloneVmResponse { vm_name, uuid }))
    }

    async fn maintenance(
        &self,
        request: Request<MaintenanceRequest>,
    ) -> Result<Response<MaintenanceResponse>, Status> {
        let req = request.into_inner();
        let mut st = self.state.write().await;
        st.maintenance = match req.action.as_str() {
            "enter" => machina_spec::HostState::Maintenance,
            "drain" => machina_spec::HostState::Draining,
            _ => machina_spec::HostState::Online,
        };
        Ok(Response::new(MaintenanceResponse {
            state: format!("{:?}", st.maintenance).to_ascii_lowercase(),
            evacuated: if req.evacuate { 0 } else { 0 },
        }))
    }

    async fn get_host_info(
        &self,
        _request: Request<GetHostInfoRequest>,
    ) -> Result<Response<GetHostInfoResponse>, Status> {
        let libvirt = self.libvirt.clone();
        let (cpu, lv, qemu) = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.host_info()
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(GetHostInfoResponse {
            cpu_model: cpu,
            libvirt_version: lv,
            qemu_version: qemu,
        }))
    }

    async fn precheck_migrate(
        &self,
        request: Request<PrecheckMigrateRequest>,
    ) -> Result<Response<PrecheckMigrateResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let dest_cpu = req.dest_cpu_model.clone();
        let dest_lv = req.dest_libvirt_version.clone();
        let checks = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.precheck_migrate(&vm_name, &dest_cpu, &dest_lv)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        let ok = checks.iter().all(|(_, passed, _)| *passed);
        Ok(Response::new(PrecheckMigrateResponse {
            ok,
            checks: checks
                .into_iter()
                .map(|(name, passed, message)| MigrateCheckItem {
                    name,
                    passed,
                    message,
                })
                .collect(),
        }))
    }

    async fn fence_host(
        &self,
        request: Request<FenceHostRequest>,
    ) -> Result<Response<FenceHostResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let hostname = if req.hostname.is_empty() {
            self.state.read().await.hostname.clone()
        } else {
            req.hostname.clone()
        };
        let method = req.method.clone();
        let ipmi_address = req.ipmi_address.clone();
        let ipmi_username = req.ipmi_username.clone();
        let ipmi_password = req.ipmi_password.clone();
        let shell_command = req.shell_command.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.fence_host(
                &hostname,
                &method,
                &ipmi_address,
                &ipmi_username,
                &ipmi_password,
                &shell_command,
            )
        })
        .await
        {
            Ok(Ok(msg)) => Ok(Response::new(FenceHostResponse { ok: true, message: msg })),
            Ok(Err(e)) => Ok(Response::new(FenceHostResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn create_snapshot(
        &self,
        request: Request<CreateSnapshotRequest>,
    ) -> Result<Response<CreateSnapshotResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let snap_name = req.snapshot_name.clone();
        let desc = req.description.clone();
        let snap_out = snap_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.create_snapshot(&vm_name, &snap_name, &desc)?;
            let dom = virt::domain::Domain::lookup_by_name(&ctx.conn, &vm_name)
                .map_err(|e| machina_core::LibvirtError::Operation(e.to_string()))?;
            let xml = dom
                .get_xml_desc(0)
                .map_err(|e| machina_core::LibvirtError::Operation(e.to_string()))?;
            let disk_path = libvirt_ops::disk_path_from_xml(&xml).unwrap_or_default();
            Ok::<_, machina_core::LibvirtError>(disk_path)
        })
        .await
        {
            Ok(Ok(disk_path)) => Ok(Response::new(CreateSnapshotResponse {
                ok: true,
                snapshot_name: snap_out,
                message: "created".into(),
                disk_path,
            })),
            Ok(Err(e)) => Ok(Response::new(CreateSnapshotResponse {
                ok: false,
                snapshot_name: String::new(),
                message: e.to_string(),
                disk_path: String::new(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn delete_snapshot(
        &self,
        request: Request<DeleteSnapshotRequest>,
    ) -> Result<Response<DeleteSnapshotResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let snap_name = req.snapshot_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.delete_snapshot(&vm_name, &snap_name)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(DeleteSnapshotResponse { deleted: true })),
            Ok(Err(e)) => Err(Status::internal(e.to_string())),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn list_snapshots(
        &self,
        request: Request<ListSnapshotsRequest>,
    ) -> Result<Response<ListSnapshotsResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let snaps = tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.list_snapshots(&vm_name)
        })
        .await
        .map_err(|e| Status::internal(e.to_string()))?
        .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(ListSnapshotsResponse {
            snapshots: snaps
                .into_iter()
                .map(|(name, state, creation_time, is_current)| SnapshotInfo {
                    name,
                    state,
                    creation_time,
                    is_current,
                })
                .collect(),
        }))
    }

    async fn backup_vm(
        &self,
        request: Request<BackupVmRequest>,
    ) -> Result<Response<BackupVmResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let dest = req.dest_path.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.backup_vm_disk(&vm_name, &dest)
        })
        .await
        {
            Ok(Ok(path)) => Ok(Response::new(BackupVmResponse {
                ok: true,
                path,
                message: "backup complete".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(BackupVmResponse {
                ok: false,
                path: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn revert_snapshot(
        &self,
        request: Request<RevertSnapshotRequest>,
    ) -> Result<Response<RevertSnapshotResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let snap_name = req.snapshot_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.revert_snapshot(&vm_name, &snap_name)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(RevertSnapshotResponse {
                ok: true,
                message: "reverted".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(RevertSnapshotResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn restore_vm_backup(
        &self,
        request: Request<RestoreVmBackupRequest>,
    ) -> Result<Response<RestoreVmBackupResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let backup_path = req.backup_path.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.restore_vm_backup(&vm_name, &backup_path)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(RestoreVmBackupResponse {
                ok: true,
                message: "restored".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(RestoreVmBackupResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn clone_from_snapshot(
        &self,
        request: Request<CloneFromSnapshotRequest>,
    ) -> Result<Response<CloneFromSnapshotResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let snap_name = req.snapshot_name.clone();
        let new_name = req.new_name.clone();
        let new_disk_path = req.new_disk_path.clone();
        let revert_source = req.revert_source;
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.clone_from_snapshot(
                &vm_name,
                &snap_name,
                &new_name,
                &new_disk_path,
                revert_source,
            )
        })
        .await
        {
            Ok(Ok((vm_name, uuid))) => Ok(Response::new(CloneFromSnapshotResponse {
                ok: true,
                vm_name,
                uuid,
                message: "cloned".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(CloneFromSnapshotResponse {
                ok: false,
                vm_name: String::new(),
                uuid: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn provision_storage_pool(
        &self,
        request: Request<ProvisionStoragePoolRequest>,
    ) -> Result<Response<ProvisionStoragePoolResponse>, Status> {
        let req = request.into_inner();
        match tokio::task::spawn_blocking(move || {
            crate::provision_ops::provision_storage_pool(&req.pool_name, &req.backend, &req.path)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(ProvisionStoragePoolResponse {
                ok: true,
                message: "provisioned".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(ProvisionStoragePoolResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn provision_network(
        &self,
        request: Request<ProvisionNetworkRequest>,
    ) -> Result<Response<ProvisionNetworkResponse>, Status> {
        let req = request.into_inner();
        match tokio::task::spawn_blocking(move || {
            crate::provision_ops::provision_network(
                &req.network_name,
                &req.backend,
                req.vlan_id,
                &req.bridge,
            )
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(ProvisionNetworkResponse {
                ok: true,
                message: "provisioned".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(ProvisionNetworkResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn attach_disk(
        &self,
        request: Request<AttachDiskRequest>,
    ) -> Result<Response<AttachDiskResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        let disk_path = req.disk_path.clone();
        let target = req.target_dev.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.attach_disk(&vm_name, &disk_path, &target)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(AttachDiskResponse {
                ok: true,
                message: "attached".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(AttachDiskResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_guest_health(
        &self,
        request: Request<GetGuestHealthRequest>,
    ) -> Result<Response<GetGuestHealthResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.guest_health(&vm_name)
        })
        .await
        {
            Ok(Ok(summary)) => Ok(Response::new(GetGuestHealthResponse {
                ok: true,
                state: summary.state,
                agent_reachable: summary.agent_reachable,
                healthy: summary.healthy,
                os_pretty_name: summary.os_pretty_name,
                guest_ip: summary.guest_ip,
                guest_hostname: summary.guest_hostname,
                issues: summary.issues,
            })),
            Ok(Err(e)) => Ok(Response::new(GetGuestHealthResponse {
                ok: false,
                state: String::new(),
                agent_reachable: false,
                healthy: false,
                os_pretty_name: String::new(),
                guest_ip: String::new(),
                guest_hostname: String::new(),
                issues: vec![e.to_string()],
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn install_guest_tools(
        &self,
        request: Request<InstallGuestToolsRequest>,
    ) -> Result<Response<InstallGuestToolsResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.install_guest_tools(&vm_name)
        })
        .await
        {
            Ok(Ok(())) => Ok(Response::new(InstallGuestToolsResponse {
                ok: true,
                message: "Guest agent channel attached — install qemu-guest-agent inside the VM if needed".into(),
            })),
            Ok(Err(e)) => Ok(Response::new(InstallGuestToolsResponse {
                ok: false,
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_firewall_inventory(
        &self,
        _request: Request<GetFirewallInventoryRequest>,
    ) -> Result<Response<GetFirewallInventoryResponse>, Status> {
        let hostname = self.state.read().await.hostname.clone();
        match tokio::task::spawn_blocking(move || {
            machina_core::gather_firewall_inventory(&hostname)
        })
        .await
        {
            Ok(Ok(inv)) => {
                let json = serde_json::to_string(&inv).unwrap_or_else(|_| "{}".into());
                Ok(Response::new(GetFirewallInventoryResponse {
                    ok: true,
                    inventory_json: json,
                    message: String::new(),
                }))
            }
            Ok(Err(e)) => Ok(Response::new(GetFirewallInventoryResponse {
                ok: false,
                inventory_json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn apply_firewall_plan(
        &self,
        request: Request<ApplyFirewallPlanRequest>,
    ) -> Result<Response<ApplyFirewallPlanResponse>, Status> {
        let req = request.into_inner();
        let hostname = self.state.read().await.hostname.clone();
        let plan: machina_core::FirewallPlanRequest =
            serde_json::from_str(&req.plan_json).unwrap_or(machina_core::FirewallPlanRequest {
                profile: None,
                enable: None,
                stealth_level: None,
                preset: None,
                dry_run: req.dry_run,
            });
        let mut plan_req = plan;
        plan_req.dry_run = req.dry_run;
        match tokio::task::spawn_blocking(move || {
            machina_core::apply_plan(&hostname, &plan_req)
        })
        .await
        {
            Ok(Ok(result)) => {
                let json = serde_json::to_string(&result).unwrap_or_else(|_| "{}".into());
                Ok(Response::new(ApplyFirewallPlanResponse {
                    ok: true,
                    result_json: json,
                    message: String::new(),
                }))
            }
            Ok(Err(e)) => Ok(Response::new(ApplyFirewallPlanResponse {
                ok: false,
                result_json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_firewall_activity(
        &self,
        _request: Request<GetFirewallActivityRequest>,
    ) -> Result<Response<GetFirewallActivityResponse>, Status> {
        let activity = serde_json::json!({
            "blocked_today": 0,
            "allowed_today": 0,
            "suspicious_scans": 0,
            "new_open_ports": 0,
            "events": [],
            "note": "PacketWolf integration provides live activity when enabled"
        });
        Ok(Response::new(GetFirewallActivityResponse {
            ok: true,
            activity_json: activity.to_string(),
            message: String::new(),
        }))
    }

    async fn get_guest_firewall_ports(
        &self,
        request: Request<GetGuestFirewallPortsRequest>,
    ) -> Result<Response<GetGuestFirewallPortsResponse>, Status> {
        let req = request.into_inner();
        let libvirt = self.libvirt.clone();
        let vm_name = req.vm_name.clone();
        match tokio::task::spawn_blocking(move || {
            let ctx = libvirt.lock().map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
            ctx.guest_firewall_ports(&vm_name)
        })
        .await
        {
            Ok(Ok((ports, agent_reachable))) => Ok(Response::new(GetGuestFirewallPortsResponse {
                ok: true,
                agent_reachable,
                ports: ports
                    .into_iter()
                    .map(|p| GuestFirewallPort {
                        port: p.port as u32,
                        protocol: p.protocol,
                        bind_address: p.bind_address,
                        process: p.process.unwrap_or_default(),
                    })
                    .collect(),
                message: String::new(),
            })),
            Ok(Err(e)) => Ok(Response::new(GetGuestFirewallPortsResponse {
                ok: false,
                agent_reachable: false,
                ports: vec![],
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_linux_observability(
        &self,
        _request: Request<GetLinuxObservabilityRequest>,
    ) -> Result<Response<GetLinuxObservabilityResponse>, Status> {
        match tokio::task::spawn_blocking(machina_core::host_linux_obs::gather_linux_observability).await
        {
            Ok(Ok(obs)) => match serde_json::to_string(&obs) {
                Ok(json) => Ok(Response::new(GetLinuxObservabilityResponse {
                    ok: true,
                    json,
                    message: String::new(),
                })),
                Err(e) => Ok(Response::new(GetLinuxObservabilityResponse {
                    ok: false,
                    json: String::new(),
                    message: e.to_string(),
                })),
            },
            Ok(Err(e)) => Ok(Response::new(GetLinuxObservabilityResponse {
                ok: false,
                json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_systemd_network_diagnostics(
        &self,
        _request: Request<GetSystemdNetworkDiagnosticsRequest>,
    ) -> Result<Response<GetSystemdNetworkDiagnosticsResponse>, Status> {
        match tokio::task::spawn_blocking(machina_core::libvirt::host_network::get_systemd_network_diagnostics)
            .await
        {
            Ok(Ok(diag)) => match serde_json::to_string(&diag) {
                Ok(json) => Ok(Response::new(GetSystemdNetworkDiagnosticsResponse {
                    ok: true,
                    json,
                    message: String::new(),
                })),
                Err(e) => Ok(Response::new(GetSystemdNetworkDiagnosticsResponse {
                    ok: false,
                    json: String::new(),
                    message: e.to_string(),
                })),
            },
            Ok(Err(e)) => Ok(Response::new(GetSystemdNetworkDiagnosticsResponse {
                ok: false,
                json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_linux_audit(
        &self,
        _request: Request<GetLinuxAuditRequest>,
    ) -> Result<Response<GetLinuxAuditResponse>, Status> {
        match tokio::task::spawn_blocking(machina_core::linux_audit::gather_linux_audit_configured).await
        {
            Ok(Ok(report)) => match serde_json::to_string(&report) {
                Ok(json) => Ok(Response::new(GetLinuxAuditResponse {
                    ok: true,
                    json,
                    message: String::new(),
                })),
                Err(e) => Ok(Response::new(GetLinuxAuditResponse {
                    ok: false,
                    json: String::new(),
                    message: e.to_string(),
                })),
            },
            Ok(Err(e)) => Ok(Response::new(GetLinuxAuditResponse {
                ok: false,
                json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_linux_package_updates(
        &self,
        _request: Request<GetLinuxPackageUpdatesRequest>,
    ) -> Result<Response<GetLinuxPackageUpdatesResponse>, Status> {
        match tokio::task::spawn_blocking(machina_core::host_platform::check_package_updates).await {
            Ok(Ok(check)) => match serde_json::to_string(&check) {
                Ok(json) => Ok(Response::new(GetLinuxPackageUpdatesResponse {
                    ok: true,
                    json,
                    message: String::new(),
                })),
                Err(e) => Ok(Response::new(GetLinuxPackageUpdatesResponse {
                    ok: false,
                    json: String::new(),
                    message: e.to_string(),
                })),
            },
            Ok(Err(e)) => Ok(Response::new(GetLinuxPackageUpdatesResponse {
                ok: false,
                json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn apply_security_bundle(
        &self,
        request: Request<ApplySecurityBundleRequest>,
    ) -> Result<Response<ApplySecurityBundleResponse>, Status> {
        let req = request.into_inner();
        let dry_run = req.dry_run;
        let bundle_json = req.bundle_json;
        match tokio::task::spawn_blocking(move || {
            machina_core::apply_security_bundle(&bundle_json, dry_run)
        })
        .await
        {
            Ok(Ok(result)) => {
                let json = serde_json::to_string(&result).unwrap_or_else(|_| "{}".into());
                Ok(Response::new(ApplySecurityBundleResponse {
                    ok: result.ok,
                    result_json: json,
                    message: result.message,
                }))
            }
            Ok(Err(e)) => Ok(Response::new(ApplySecurityBundleResponse {
                ok: false,
                result_json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn get_security_fabric_status(
        &self,
        _request: Request<GetSecurityFabricStatusRequest>,
    ) -> Result<Response<GetSecurityFabricStatusResponse>, Status> {
        match tokio::task::spawn_blocking(machina_core::security_fabric_status).await {
            Ok(Ok(status)) => {
                let json = serde_json::to_string(&status).unwrap_or_else(|_| "{}".into());
                Ok(Response::new(GetSecurityFabricStatusResponse {
                    ok: true,
                    status_json: json,
                    message: String::new(),
                }))
            }
            Ok(Err(e)) => Ok(Response::new(GetSecurityFabricStatusResponse {
                ok: false,
                status_json: String::new(),
                message: e.to_string(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }
}
