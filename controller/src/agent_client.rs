// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use machina_agent::pb::host_agent_client::HostAgentClient;
use machina_agent::pb::*;
use std::path::Path;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};

pub fn normalize_agent_addr(addr: &str) -> String {
    let s = addr.trim();
    let s = s.strip_prefix("http://").unwrap_or(s);
    let s = s.strip_prefix("https://").unwrap_or(s);
    s.to_string()
}

pub async fn connect(addr: &str) -> anyhow::Result<HostAgentClient<Channel>> {
    let normalized = normalize_agent_addr(addr);
    let use_tls = std::env::var("MACHINA_AGENT_CA")
        .ok()
        .filter(|p| Path::new(p).exists());
    let endpoint_url = if use_tls.is_some() {
        format!("https://{normalized}")
    } else {
        format!("http://{normalized}")
    };
    let mut endpoint = Endpoint::from_shared(endpoint_url)?;
    if let Some(ca_path) = use_tls {
        let ca = tokio::fs::read_to_string(&ca_path).await?;
        let mut tls = ClientTlsConfig::new().ca_certificate(Certificate::from_pem(ca));
        if let (Ok(cert_path), Ok(key_path)) = (
            std::env::var("MACHINA_AGENT_CLIENT_CERT"),
            std::env::var("MACHINA_AGENT_CLIENT_KEY"),
        ) {
            if Path::new(&cert_path).exists() && Path::new(&key_path).exists() {
                let cert = tokio::fs::read_to_string(&cert_path).await?;
                let key = tokio::fs::read_to_string(&key_path).await?;
                tls = tls.identity(Identity::from_pem(cert, key));
            }
        }
        endpoint = endpoint.tls_config(tls)?;
    }
    let channel = endpoint.connect().await?;
    Ok(HostAgentClient::new(channel))
}

pub async fn list_vms(client: &mut HostAgentClient<Channel>) -> anyhow::Result<ListVmsResponse> {
    Ok(client.list_vms(ListVmsRequest {}).await?.into_inner())
}

pub async fn list_networks(
    client: &mut HostAgentClient<Channel>,
) -> anyhow::Result<ListNetworksResponse> {
    Ok(client
        .list_networks(ListNetworksRequest {})
        .await?
        .into_inner())
}

pub async fn list_storage_pools(
    client: &mut HostAgentClient<Channel>,
) -> anyhow::Result<ListStoragePoolsResponse> {
    Ok(client
        .list_storage_pools(ListStoragePoolsRequest {})
        .await?
        .into_inner())
}

pub async fn apply_vm(
    client: &mut HostAgentClient<Channel>,
    spec_json: &str,
    disk_path: &str,
    template_source: Option<&str>,
    cloud_init_user: &str,
    cloud_init_password: &str,
    cloud_init_ssh_pubkey: &str,
) -> anyhow::Result<ApplyVmResponse> {
    Ok(client
        .apply_vm(ApplyVmRequest {
            spec_json: spec_json.to_string(),
            disk_path: disk_path.to_string(),
            template_source: template_source.unwrap_or("").to_string(),
            cloud_init_user: cloud_init_user.to_string(),
            cloud_init_password: cloud_init_password.to_string(),
            cloud_init_ssh_pubkey: cloud_init_ssh_pubkey.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn vm_power(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    action: &str,
    mode: Option<&str>,
) -> anyhow::Result<VmPowerResponse> {
    Ok(client
        .vm_power(VmPowerRequest {
            vm_name: vm_name.to_string(),
            action: action.to_string(),
            mode: mode.unwrap_or("").to_string(),
        })
        .await?
        .into_inner())
}

pub async fn guest_agent_action(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    action: &str,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .guest_agent_action(GuestAgentActionRequest {
            vm_name: vm_name.to_string(),
            action: action.to_string(),
        })
        .await?
        .into_inner();
    if !resp.ok {
        anyhow::bail!("{}", resp.message);
    }
    serde_json::from_str(&resp.result_json).map_err(|e| anyhow::anyhow!("guest action JSON: {e}"))
}

pub async fn get_domain_xml(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<String> {
    Ok(client
        .get_domain_xml(GetDomainXmlRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner()
        .xml)
}

pub async fn delete_vm(client: &mut HostAgentClient<Channel>, vm_name: &str) -> anyhow::Result<()> {
    client
        .delete_vm(DeleteVmRequest {
            vm_name: vm_name.to_string(),
        })
        .await?;
    Ok(())
}

pub async fn heartbeat(
    client: &mut HostAgentClient<Channel>,
    host_id: &str,
) -> anyhow::Result<HeartbeatResponse> {
    Ok(client
        .heartbeat(HeartbeatRequest {
            host_id: host_id.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn get_console(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<GetConsoleResponse> {
    Ok(client
        .get_console(GetConsoleRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn get_console_access_plan(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<GetConsoleAccessPlanResponse> {
    Ok(client
        .get_console_access_plan(GetConsoleAccessPlanRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn migrate_vm(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    dest_uri: &str,
    live: bool,
    bandwidth_mib: u64,
    postcopy: bool,
    undefine_source: bool,
    tunnelled: bool,
    migrate_disks: Vec<String>,
    disks_uri: Option<String>,
    copy_storage: bool,
) -> anyhow::Result<MigrateVmResponse> {
    Ok(client
        .migrate_vm(MigrateVmRequest {
            vm_name: vm_name.to_string(),
            dest_uri: dest_uri.to_string(),
            live,
            bandwidth_mib,
            postcopy,
            undefine_source,
            tunnelled,
            migrate_disks,
            disks_uri: disks_uri.unwrap_or_default(),
            copy_storage,
        })
        .await?
        .into_inner())
}

pub async fn clone_vm(
    client: &mut HostAgentClient<Channel>,
    source: &str,
    new_name: &str,
    clone_mode: &str,
) -> anyhow::Result<CloneVmResponse> {
    Ok(client
        .clone_vm(CloneVmRequest {
            source_name: source.to_string(),
            new_name: new_name.to_string(),
            spec_json: String::new(),
            clone_mode: clone_mode.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn maintenance(
    client: &mut HostAgentClient<Channel>,
    action: &str,
    evacuate: bool,
) -> anyhow::Result<MaintenanceResponse> {
    Ok(client
        .maintenance(MaintenanceRequest {
            action: action.to_string(),
            evacuate,
        })
        .await?
        .into_inner())
}

pub async fn get_host_info(
    client: &mut HostAgentClient<Channel>,
) -> anyhow::Result<GetHostInfoResponse> {
    Ok(client
        .get_host_info(GetHostInfoRequest {})
        .await?
        .into_inner())
}

pub async fn precheck_migrate(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    dest_cpu_model: &str,
    dest_libvirt_version: &str,
) -> anyhow::Result<PrecheckMigrateResponse> {
    Ok(client
        .precheck_migrate(PrecheckMigrateRequest {
            vm_name: vm_name.to_string(),
            dest_cpu_model: dest_cpu_model.to_string(),
            dest_libvirt_version: dest_libvirt_version.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn fence_host(
    client: &mut HostAgentClient<Channel>,
    hostname: &str,
    method: &str,
    ipmi_address: &str,
    ipmi_username: &str,
    ipmi_password: &str,
    shell_command: &str,
) -> anyhow::Result<FenceHostResponse> {
    Ok(client
        .fence_host(FenceHostRequest {
            action: "fence".into(),
            method: method.to_string(),
            ipmi_address: ipmi_address.to_string(),
            ipmi_username: ipmi_username.to_string(),
            ipmi_password: ipmi_password.to_string(),
            shell_command: shell_command.to_string(),
            hostname: hostname.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn create_snapshot(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    snapshot_name: &str,
    description: &str,
    disk_only: bool,
    quiesce: bool,
    storage_mode: &str,
) -> anyhow::Result<CreateSnapshotResponse> {
    Ok(client
        .create_snapshot(CreateSnapshotRequest {
            vm_name: vm_name.to_string(),
            snapshot_name: snapshot_name.to_string(),
            description: description.to_string(),
            disk_only,
            quiesce,
            storage_mode: storage_mode.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn delete_snapshot(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    snapshot_name: &str,
) -> anyhow::Result<DeleteSnapshotResponse> {
    Ok(client
        .delete_snapshot(DeleteSnapshotRequest {
            vm_name: vm_name.to_string(),
            snapshot_name: snapshot_name.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn list_snapshots(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<ListSnapshotsResponse> {
    Ok(client
        .list_snapshots(ListSnapshotsRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn backup_vm(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    dest_path: &str,
) -> anyhow::Result<BackupVmResponse> {
    Ok(client
        .backup_vm(BackupVmRequest {
            vm_name: vm_name.to_string(),
            dest_path: dest_path.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn revert_snapshot(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    snapshot_name: &str,
) -> anyhow::Result<RevertSnapshotResponse> {
    Ok(client
        .revert_snapshot(RevertSnapshotRequest {
            vm_name: vm_name.to_string(),
            snapshot_name: snapshot_name.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn restore_vm_backup(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    backup_path: &str,
) -> anyhow::Result<RestoreVmBackupResponse> {
    Ok(client
        .restore_vm_backup(RestoreVmBackupRequest {
            vm_name: vm_name.to_string(),
            backup_path: backup_path.to_string(),
        })
        .await?
        .into_inner())
}

pub async fn clone_from_snapshot(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    snapshot_name: &str,
    new_name: &str,
    new_disk_path: &str,
    revert_source: bool,
) -> anyhow::Result<CloneFromSnapshotResponse> {
    Ok(client
        .clone_from_snapshot(CloneFromSnapshotRequest {
            vm_name: vm_name.to_string(),
            snapshot_name: snapshot_name.to_string(),
            new_name: new_name.to_string(),
            new_disk_path: new_disk_path.to_string(),
            revert_source,
        })
        .await?
        .into_inner())
}

pub async fn provision_storage_pool(
    client: &mut HostAgentClient<Channel>,
    pool_name: &str,
    backend: &str,
    path: &str,
) -> anyhow::Result<()> {
    let resp = client
        .provision_storage_pool(ProvisionStoragePoolRequest {
            pool_name: pool_name.to_string(),
            backend: backend.to_string(),
            path: path.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn provision_network(
    client: &mut HostAgentClient<Channel>,
    network_name: &str,
    backend: &str,
    vlan_id: i32,
    bridge: &str,
) -> anyhow::Result<()> {
    let resp = client
        .provision_network(ProvisionNetworkRequest {
            network_name: network_name.to_string(),
            backend: backend.to_string(),
            vlan_id,
            bridge: bridge.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn attach_disk(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    disk_path: &str,
    target_dev: &str,
) -> anyhow::Result<()> {
    let resp = client
        .attach_disk(AttachDiskRequest {
            vm_name: vm_name.to_string(),
            disk_path: disk_path.to_string(),
            target_dev: target_dev.to_string(),
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

fn vm_op_response(ok: bool, message: &str) -> anyhow::Result<()> {
    if ok {
        Ok(())
    } else {
        anyhow::bail!("{message}")
    }
}

pub async fn detach_disk(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    target_dev: &str,
) -> anyhow::Result<()> {
    let resp = client
        .detach_disk(DetachDiskRequest {
            vm_name: vm_name.to_string(),
            target_dev: target_dev.to_string(),
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn resize_disk(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    target_dev: &str,
    size_gb: u64,
) -> anyhow::Result<()> {
    let resp = client
        .resize_disk(ResizeDiskRequest {
            vm_name: vm_name.to_string(),
            target_dev: target_dev.to_string(),
            size_gb,
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn attach_nic(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    network: &str,
    model: &str,
) -> anyhow::Result<()> {
    let resp = client
        .attach_nic(AttachNicRequest {
            vm_name: vm_name.to_string(),
            network: network.to_string(),
            model: model.to_string(),
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn detach_nic(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    mac_address: &str,
) -> anyhow::Result<()> {
    let resp = client
        .detach_nic(DetachNicRequest {
            vm_name: vm_name.to_string(),
            mac_address: mac_address.to_string(),
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn set_autostart(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    enabled: bool,
) -> anyhow::Result<()> {
    let resp = client
        .set_autostart(SetAutostartRequest {
            vm_name: vm_name.to_string(),
            enabled,
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn set_vcpus(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    count: u32,
) -> anyhow::Result<()> {
    let resp = client
        .set_vcpus(SetVcpusRequest {
            vm_name: vm_name.to_string(),
            count,
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn set_memory(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    memory_mb: u64,
) -> anyhow::Result<()> {
    let resp = client
        .set_memory(SetMemoryRequest {
            vm_name: vm_name.to_string(),
            memory_mb,
        })
        .await?
        .into_inner();
    vm_op_response(resp.ok, &resp.message)
}

pub async fn vm_libvirt_query(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    action: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .vm_libvirt_query(VmLibvirtQueryRequest {
            vm_name: vm_name.to_string(),
            action: action.to_string(),
            payload_json: serde_json::to_string(payload)?,
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json).map_err(|e| anyhow::anyhow!("decode query: {e}"))
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn vm_libvirt_invoke(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
    action: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .vm_libvirt_invoke(VmLibvirtInvokeRequest {
            vm_name: vm_name.to_string(),
            action: action.to_string(),
            payload_json: serde_json::to_string(payload)?,
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json).map_err(|e| anyhow::anyhow!("decode invoke: {e}"))
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn host_libvirt_query(
    client: &mut HostAgentClient<Channel>,
    action: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .host_libvirt_query(HostLibvirtQueryRequest {
            action: action.to_string(),
            payload_json: serde_json::to_string(payload)?,
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json)
            .map_err(|e| anyhow::anyhow!("decode host query: {e}"))
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn host_libvirt_invoke(
    client: &mut HostAgentClient<Channel>,
    action: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .host_libvirt_invoke(HostLibvirtInvokeRequest {
            action: action.to_string(),
            payload_json: serde_json::to_string(payload)?,
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json)
            .map_err(|e| anyhow::anyhow!("decode host invoke: {e}"))
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

pub async fn get_vm_details(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<machina_core::state::VmDetails> {
    let resp = client
        .get_vm_details(GetVmDetailsRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.details_json)
            .map_err(|e| anyhow::anyhow!("decode vm details: {e}"))
    } else {
        anyhow::bail!("{}", resp.message)
    }
}

#[derive(Debug, Clone)]
pub struct GuestHealthResult {
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

pub async fn get_guest_health(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<GuestHealthResult> {
    let resp = client
        .get_guest_health(GetGuestHealthRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(GuestHealthResult {
            agent_reachable: resp.agent_reachable,
            healthy: resp.healthy,
            os_pretty_name: resp.os_pretty_name,
            guest_ip: resp.guest_ip,
            guest_hostname: resp.guest_hostname,
            issues: resp.issues,
            install_state: resp.install_state,
            channel_attached: resp.channel_attached,
            channel_connected: resp.channel_connected,
            agent_ping: resp.agent_ping,
            agent_version: resp.agent_version,
            diagnostics_json: resp.diagnostics_json,
        })
    } else {
        Ok(GuestHealthResult {
            agent_reachable: false,
            healthy: false,
            os_pretty_name: String::new(),
            guest_ip: String::new(),
            guest_hostname: String::new(),
            issues: resp.issues,
            install_state: resp.install_state,
            channel_attached: resp.channel_attached,
            channel_connected: resp.channel_connected,
            agent_ping: resp.agent_ping,
            agent_version: resp.agent_version,
            diagnostics_json: resp.diagnostics_json,
        })
    }
}

pub async fn get_guest_observability(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<serde_json::Value> {
    let resp = client
        .get_guest_observability(GetGuestObservabilityRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner();
    if !resp.ok {
        anyhow::bail!("{}", resp.message);
    }
    let v: serde_json::Value =
        serde_json::from_str(&resp.guest_json).unwrap_or(serde_json::json!({}));
    Ok(v)
}

pub async fn install_guest_tools(
    client: &mut HostAgentClient<Channel>,
    vm_name: &str,
) -> anyhow::Result<()> {
    let resp = client
        .install_guest_tools(InstallGuestToolsRequest {
            vm_name: vm_name.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_firewall_inventory(addr: &str) -> anyhow::Result<machina_core::FirewallInventory> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_firewall_inventory(GetFirewallInventoryRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.inventory_json)
            .map_err(|e| anyhow::anyhow!("inventory json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn apply_firewall_plan(
    addr: &str,
    req: &machina_core::FirewallPlanRequest,
    dry_run: bool,
) -> anyhow::Result<machina_core::FirewallPlanResult> {
    let mut client = connect(addr).await?;
    let plan_json = serde_json::to_string(req)?;
    let resp = client
        .apply_firewall_plan(ApplyFirewallPlanRequest { plan_json, dry_run })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json).map_err(|e| anyhow::anyhow!("plan json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn apply_security_bundle(
    addr: &str,
    bundle_json: &str,
    dry_run: bool,
) -> anyhow::Result<machina_core::SecurityBundleApplyResult> {
    let mut client = connect(addr).await?;
    let resp = client
        .apply_security_bundle(ApplySecurityBundleRequest {
            bundle_json: bundle_json.to_string(),
            dry_run,
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.result_json).map_err(|e| anyhow::anyhow!("result json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_security_fabric_status(
    addr: &str,
) -> anyhow::Result<machina_core::SecurityFabricStatus> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_security_fabric_status(GetSecurityFabricStatusRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.status_json).map_err(|e| anyhow::anyhow!("status json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub struct GuestFirewallPortsResponse {
    pub agent_reachable: bool,
    pub ports: Vec<machina_core::GuestListeningPort>,
}

pub async fn get_guest_firewall_ports(
    addr: &str,
    vm_name: &str,
) -> anyhow::Result<GuestFirewallPortsResponse> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_guest_firewall_ports(GetGuestFirewallPortsRequest {
            vm_name: vm_name.into(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(GuestFirewallPortsResponse {
            agent_reachable: resp.agent_reachable,
            ports: resp
                .ports
                .into_iter()
                .map(|p| machina_core::GuestListeningPort {
                    port: p.port as u16,
                    protocol: p.protocol,
                    bind_address: p.bind_address,
                    process: if p.process.is_empty() {
                        None
                    } else {
                        Some(p.process)
                    },
                })
                .collect(),
        })
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_firewall_activity(addr: &str, hours: u32) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_firewall_activity(GetFirewallActivityRequest { hours })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.activity_json).map_err(|e| anyhow::anyhow!("activity json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_lldp(
    agent_console_addr: &str,
) -> anyhow::Result<machina_core::libvirt::host_network::LldpInventory> {
    let normalized = normalize_agent_addr(agent_console_addr);
    let url = format!("http://{normalized}/api/v1/host/lldp");
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()?
        .get(&url)
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("agent LLDP HTTP {}", resp.status());
    }
    Ok(resp.json().await?)
}

pub async fn get_linux_observability(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_linux_observability(GetLinuxObservabilityRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json).map_err(|e| anyhow::anyhow!("linux obs json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_systemd_network_diagnostics(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_systemd_network_diagnostics(GetSystemdNetworkDiagnosticsRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json).map_err(|e| anyhow::anyhow!("network diag json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_linux_audit(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_linux_audit(GetLinuxAuditRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json).map_err(|e| anyhow::anyhow!("linux audit json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_linux_package_updates(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_linux_package_updates(GetLinuxPackageUpdatesRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json)
            .map_err(|e| anyhow::anyhow!("linux package updates json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn apply_linux_package_upgrade(
    addr: &str,
    dry_run: bool,
) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .apply_linux_package_upgrade(ApplyLinuxPackageUpgradeRequest { dry_run })
        .await?
        .into_inner();
    if resp.ok {
        let value = serde_json::from_str(&resp.json)
            .unwrap_or_else(|_| serde_json::json!({ "stdout": resp.message, "ok": true }));
        Ok(value)
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn host_linux_reboot(addr: &str) -> anyhow::Result<()> {
    let mut client = connect(addr).await?;
    let resp = client
        .host_linux_reboot(HostLinuxRebootRequest {})
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_linux_filesystems(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_linux_filesystems(GetLinuxFilesystemsRequest {})
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json).map_err(|e| anyhow::anyhow!("linux filesystems json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn get_linux_top_processes(
    addr: &str,
    limit: u32,
    order: &str,
) -> anyhow::Result<serde_json::Value> {
    let mut client = connect(addr).await?;
    let resp = client
        .get_linux_top_processes(GetLinuxTopProcessesRequest {
            limit,
            order: order.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        serde_json::from_str(&resp.json).map_err(|e| anyhow::anyhow!("linux processes json: {e}"))
    } else {
        anyhow::bail!(resp.message)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PortForwardRuleDto {
    pub id: String,
    pub protocol: String,
    pub host_port: u16,
    pub vm_ip: String,
    pub vm_port: u16,
    pub description: String,
}

pub async fn list_port_forwards(addr: &str) -> anyhow::Result<Vec<PortForwardRuleDto>> {
    let mut client = connect(addr).await?;
    let resp = client
        .list_port_forwards(ListPortForwardsRequest {})
        .await?
        .into_inner();
    if !resp.message.is_empty() && resp.rules.is_empty() {
        anyhow::bail!(resp.message);
    }
    Ok(resp
        .rules
        .into_iter()
        .map(|r| PortForwardRuleDto {
            id: r.id,
            protocol: r.protocol,
            host_port: r.host_port as u16,
            vm_ip: r.vm_ip,
            vm_port: r.vm_port as u16,
            description: r.description,
        })
        .collect())
}

pub async fn create_port_forward(
    addr: &str,
    protocol: &str,
    host_port: u16,
    vm_ip: &str,
    vm_port: u16,
    description: &str,
) -> anyhow::Result<()> {
    let mut client = connect(addr).await?;
    let resp = client
        .create_port_forward(CreatePortForwardRequest {
            protocol: protocol.to_string(),
            host_port: host_port as u32,
            vm_ip: vm_ip.to_string(),
            vm_port: vm_port as u32,
            description: description.to_string(),
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn delete_port_forward(
    addr: &str,
    protocol: &str,
    host_port: u16,
    vm_ip: &str,
    vm_port: u16,
) -> anyhow::Result<()> {
    let mut client = connect(addr).await?;
    let resp = client
        .delete_port_forward(DeletePortForwardRequest {
            protocol: protocol.to_string(),
            host_port: host_port as u32,
            vm_ip: vm_ip.to_string(),
            vm_port: vm_port as u32,
        })
        .await?
        .into_inner();
    if resp.ok {
        Ok(())
    } else {
        anyhow::bail!(resp.message)
    }
}

pub async fn list_host_gpus(
    client: &mut HostAgentClient<Channel>,
) -> anyhow::Result<ListHostGpusResponse> {
    Ok(client
        .list_host_gpus(ListHostGpusRequest {})
        .await?
        .into_inner())
}
