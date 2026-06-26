// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

pub mod api_error;
pub mod audit;
pub mod audit_ship;
pub mod bpf_probe;
pub mod build_precheck;
pub mod config;
pub mod firewall;
pub mod fleet_placement;
pub mod fmt;
pub mod host_cockpit;
pub mod host_inventory;
pub mod host_linux_obs;
pub mod host_platform;
pub mod host_virt;
pub mod identity_settings;
pub mod k8s_top;
pub mod kubevirt;
pub mod ldap_role;
pub mod ldap_settings;
pub mod libvirt;
pub mod linux_audit;
pub mod metrics_history;
pub mod network;
pub mod obs_counters;
pub mod observability_settings;
pub mod openstack;
pub mod otlp;
pub mod prometheus_remote_write;
pub mod prometheus_text;
pub mod run_as_user;
pub mod state;
pub mod system_accounts;
pub mod tetragon;
pub mod trace_context;
pub mod validate;
pub mod xml;

pub use api_error::{
    format_http_error_body, format_user_error, friendly_error_code, sanitize_error_text,
};
pub use config::{
    AuthConfig, FleetConfig, FleetPeer, GuestkitConfig, HypersdkConfig, KubeVirtConfig, LdapConfig,
    MachinaConfig, OidcConfig, OidcDefaultRole, OpenStackConfig, PacketwolfConfig, RunAsUserConfig,
    SshTerminalConfig, SshTerminalTarget, VmCreateBackend, DEFAULT_DAEMON_PORT,
};
pub use firewall::{
    apply_k8s_plan, apply_plan, builtin_profiles, cloud_sg_monthly_cost, compile_k8s_policies,
    compile_metal_plan, compile_profile_plan, compute_diff, compute_firewall_score, detect_backend,
    detect_k8s_backend, exposure_chargeback_tag, fleet_exposure_monthly, gather_cloud_inventory,
    gather_firewall_inventory, gather_metal_inventory, gpu_profile_exposure_cost,
    guest_ports_to_open_ports, idle_open_port_cost, is_public_bind, k8s_cluster_ready,
    metal_preset_temporary_bmc, metal_preset_temporary_pxe, mission_stack_network_cost,
    port_monthly_cost, profile_by_name, profile_exposure_multiplier, public_port_finops_alert,
    scan_guest_listening_ports, scan_ipmi_exposure, simulate_connectivity,
    storage_profile_exposure_cost, CloudFirewallInventory, CloudProvider, ConnectivityMatrix,
    ExposureRisk, FirewallBackend, FirewallInventory, FirewallPlanRequest, FirewallPlanResult,
    FirewallPosture, FirewallProfile, FirewallRule as ZeusFirewallRule, FirewallScore,
    GuestListeningPort, K8sPolicyManifest, MetalExposureScan, MetalServerInput, OpenPort,
    StealthLevel, GPU_EXPOSURE_MULTIPLIER, STORAGE_EXPOSURE_MULTIPLIER,
};
pub use fleet_placement::{fleet_capacity_score, placement_adjusted_score};
pub use identity_settings::{
    apply_oidc_patch, apply_saml_patch, oidc_settings_view_from_config,
    saml_settings_view_from_config, OidcSettingsPatch, OidcSettingsView, SamlSettingsPatch,
    SamlSettingsView,
};
pub use k8s_top::{parse_kubectl_top_line, K8sTopRow};
pub use kubevirt::{
    kubevirt_bundle_from_libvirt_vm, kubevirt_bundle_from_qcow2, resolve_guest_os, GuestOsFamily,
    KubeVirtBundle,
};
pub use ldap_settings::{
    apply_ldap_patch, ldap_settings_view_from_config, zyvorai_local_preset, LdapSettingsPatch,
    LdapSettingsView, LdapTestRequest, LdapTestResponse,
};
pub use libvirt::{LibvirtManager, LibvirtTarget};
pub use network::overlay::{
    compile_micro_segment_rules, default_segment_presets, ip_from_cidr_offset,
    segment_micro_seg_grade, validate_cidr, EastWestDefault, SegmentSpec, SegmentTier,
};
pub use observability_settings::{
    apply_observability_patch, settings_view_from_config, AuditObservabilityView,
    MetricsHistoryRemoteView, ObservabilitySettingsPatch, ObservabilitySettingsView,
    OtlpSettingsView,
};
pub use openstack::{
    accept_volume_transfer, add_aggregate_host, add_image_member, add_router_interface,
    add_security_group, associate_floating_ip, attach_interface, attach_volume, backup_instance,
    build_network_topology, clone_cinder_volume, confirm_resize_instance, connect_cloud,
    connection_status_skeleton, create_cinder_volume, create_flavor, create_floating_ip,
    create_heat_stack, create_host_aggregate, create_identity_project, create_identity_user,
    create_instance, create_keypair, create_lb_health_monitor, create_lb_listener,
    create_lb_member, create_lb_pool, create_load_balancer, create_network, create_port,
    create_router, create_security_group, create_security_group_rule, create_server_group,
    create_subnet, create_volume_from_image, create_volume_from_snapshot, create_volume_transfer,
    default_cloud_from_yaml, delete_cinder_snapshot, delete_cinder_volume, delete_flavor,
    delete_floating_ip, delete_glance_image, delete_heat_stack, delete_image_member,
    delete_instance, delete_keypair, delete_lb_health_monitor, delete_lb_listener,
    delete_lb_member, delete_lb_pool, delete_load_balancer, delete_network, delete_port,
    delete_router, delete_security_group, delete_security_group_rule, delete_server_group,
    delete_subnet, delete_volume_transfer, detach_interface, detach_volume, dissociate_floating_ip,
    effective_cloud_name_for_config, enrich_instance_flavor, export_instance_plan,
    export_instance_to_disk, extend_cinder_volume, force_delete_instance, get_cinder_snapshot,
    get_cinder_volume, get_console_output, get_flavor, get_floating_ip, get_heat_stack,
    get_heat_stack_template, get_hypervisor, get_identity_project, get_identity_user, get_image,
    get_instance, get_load_balancer, get_network, get_port, get_quota_summary, get_remote_console,
    get_router, get_security_group, get_server_group, get_subnet, get_volume_transfer,
    grant_role_assignment, instance_stack_hint, is_openstack_configured, issue_console_token,
    libvirt_openstack_push_preview, libvirt_root_disk_path, list_availability_zones,
    list_cinder_snapshots, list_cinder_volumes, list_compute_services, list_configured_clouds,
    list_flavors, list_floating_ips, list_heat_stack_events, list_heat_stack_resources,
    list_heat_stacks, list_host_aggregates, list_hypervisors, list_identity_projects,
    list_identity_roles, list_identity_users, list_image_members, list_images,
    list_instance_floating_ips, list_instance_interfaces, list_instance_volumes, list_instances,
    list_keypairs, list_lb_health_monitors, list_lb_listeners, list_lb_members, list_lb_pools,
    list_load_balancers, list_networks, list_neutron_agents, list_ports, list_role_assignments,
    list_routers, list_security_groups, list_server_groups, list_subnets, list_volume_transfers,
    list_volume_types, lock_instance, migrate_instance, pause_instance, preview_qcow2_upload,
    probe_heat_reachable, probe_octavia_reachable, pull_glance_image_to_disk, reboot_instance,
    rebuild_instance, remote_console_with_tunnel, remove_aggregate_host, remove_router_interface,
    remove_security_group, rename_instance, rescue_instance, reset_instance_state, resize_instance,
    resolve_clouds_yaml_path, resolve_console_token, resume_instance, retype_cinder_volume,
    revert_resize_instance, revoke_role_assignment, set_compute_service_state,
    set_hypervisor_maintenance, set_neutron_agent_admin, set_volume_bootable, shelve_instance,
    snapshot_cinder_volume, snapshot_instance, start_instance, stop_instance, suspend_instance,
    test_connection, unlock_instance, unpause_instance, unrescue_instance, unshelve_instance,
    update_cinder_volume, update_heat_stack, update_host_aggregate, update_identity_user,
    update_image_metadata, update_image_visibility, update_instance_metadata, update_network,
    update_port, update_quotas, update_router, update_subnet, upload_qcow2_to_glance,
    upload_volume_to_image, AcceptVolumeTransferRequest, AddImageMemberRequest,
    AddRouterInterfaceRequest, AssociateFloatingIpRequest, AttachInterfaceRequest,
    AttachVolumeRequest, BackupInstanceRequest, CloneVolumeRequest, CreateAggregateRequest,
    CreateFlavorRequest, CreateFloatingIpRequest, CreateHeatStackRequest,
    CreateIdentityProjectRequest, CreateIdentityUserRequest, CreateInstanceRequest,
    CreateInstanceResponse, CreateKeypairRequest, CreateLbHealthMonitorRequest,
    CreateLbListenerRequest, CreateLbMemberRequest, CreateLbPoolRequest, CreateLoadBalancerRequest,
    CreateNetworkRequest as OpenStackCreateNetworkRequest, CreatePortRequest,
    CreateRouterRequest as OpenStackCreateRouterRequest, CreateSecurityGroupRequest,
    CreateSecurityGroupRuleRequest, CreateServerGroupRequest,
    CreateSubnetRequest as OpenStackCreateSubnetRequest, CreateVolumeFromImageRequest,
    CreateVolumeFromSnapshotRequest, CreateVolumeTransferRequest, ExtendVolumeRequest,
    GlancePullRequest, GlancePullResult, GlanceUploadPreview, GlanceUploadRequest,
    GlanceUploadResult, LibvirtOpenStackPushPreview, ListInstancesParams, ListInstancesResult,
    MigrateInstanceRequest, NetworkTopologyGraph, OpenStackAttachedVolume,
    OpenStackAvailabilityZone, OpenStackCloudEntry, OpenStackComputeService,
    OpenStackConnectionStatus, OpenStackConsoleOutput, OpenStackCreateVolumeRequest,
    OpenStackExportPlan, OpenStackFlavor, OpenStackFloatingIp, OpenStackHeatEvent,
    OpenStackHeatOutput, OpenStackHeatResource, OpenStackHeatStack, OpenStackHostAggregate,
    OpenStackHypervisor, OpenStackIdentityUser, OpenStackImage, OpenStackImageMember,
    OpenStackInstance, OpenStackInstanceInterface, OpenStackKeyPair, OpenStackLbHealthMonitor,
    OpenStackLbListener, OpenStackLbMember, OpenStackLbPool, OpenStackLoadBalancer,
    OpenStackNetwork, OpenStackNeutronAgent, OpenStackPort, OpenStackPortCreated, OpenStackProject,
    OpenStackQuotaSummary, OpenStackRemoteConsole, OpenStackRole, OpenStackRoleAssignment,
    OpenStackRouter, OpenStackSecurityGroup, OpenStackSecurityGroupRule, OpenStackServerGroup,
    OpenStackSubnet, OpenStackVolumeSnapshot, OpenStackVolumeTransfer, OpenStackVolumeType,
    RebuildInstanceRequest, RemoveRouterInterfaceRequest, RenameInstanceRequest,
    RescueInstanceRequest, ResizeInstanceRequest, RetypeVolumeRequest, RoleAssignmentRequest,
    SetComputeServiceRequest, SnapshotVolumeRequest, TopologyEdge, TopologyNode,
    UpdateAggregateRequest, UpdateHeatStackRequest, UpdateIdentityUserRequest,
    UpdateImageMetadataRequest, UpdateImageVisibilityRequest, UpdateMetadataRequest,
    UpdateNetworkRequest, UpdatePortRequest, UpdateQuotasRequest, UpdateRouterRequest,
    UpdateSubnetRequest, UpdateVolumeRequest, UploadVolumeToImageRequest,
    UploadVolumeToImageResponse,
};
pub use prometheus_remote_write::{
    decode_remote_write_body, encode_remote_write_body, encode_remote_write_v2_body,
    host_percents_from_remote_write, samples_from_write_request, write_request_v2_with_gauge,
    write_request_with_gauge, RemoteWriteDecodeResult,
};
pub use prometheus_text::{
    host_percents_from_samples, inject_peer_label, parse_prometheus_text, PrometheusSample,
};
pub use state::{
    AppState, AttachDiskRequest, AuditEvent, BackupInfo, BackupRequest, CloneVmRequest,
    ConfirmationDialog, CreateNetworkRequest, CreateSnapshotRequest, CreateVmRequest,
    CreateVolumeRequest, DashboardStats, DiskInfo, Focus, InputMode, InterfaceInfo, NetworkInfo,
    NodeInfo, NotifyLevel, ObjectTab, OpenStackCreateStep, OpenStackCreateWizard, RenameVmRequest,
    ResourceView, RestoreRequest, SidebarCategory, SidebarItem, SnapshotInfo, SortColumn,
    SortDirection, StoragePoolInfo, StorageVolumeInfo, ViewMode, VmBlockDeviceMetrics, VmDetails,
    VmInfo, VmMetrics, VmNetDeviceMetrics, VmTemplate,
};
pub use tetragon::{
    apply_security_bundle, render_install_script, run_tetragon_install, security_fabric_status,
    SecurityBundleApplyResult, SecurityFabricStatus, TetragonInstallResult, TetragonInstallSpec,
};
pub use trace_context::{format_traceparent, trace_context_from_headers, HttpTraceContext};

pub const UNKNOWN: &str = "unknown";

pub fn unknown_string() -> String {
    UNKNOWN.to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum LibvirtError {
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid input: {0}")]
    Invalid(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Operation failed: {0}")]
    Operation(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl LibvirtError {
    pub fn map_op<E: std::fmt::Display>(msg: &str) -> impl FnOnce(E) -> Self + '_ {
        move |e| Self::Operation(format!("{msg}: {e}"))
    }
}
