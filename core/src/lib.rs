// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

pub mod api_error;
pub mod audit;
pub mod audit_ship;
pub mod bpf_probe;
pub mod linux_audit;
pub mod observability_settings;
pub mod fleet_placement;
pub mod k8s_top;
pub mod prometheus_remote_write;
pub mod prometheus_text;
pub mod trace_context;
pub mod otlp;
pub mod run_as_user;
pub mod build_precheck;
pub mod config;
pub mod fmt;
pub mod host_inventory;
pub mod metrics_history;
pub mod host_linux_obs;
pub mod host_platform;
pub mod host_virt;
pub mod ldap_role;
pub mod obs_counters;
pub mod kubevirt;
pub mod openstack;
pub mod libvirt;
pub mod state;
pub mod system_accounts;
pub mod validate;
pub mod xml;

pub use api_error::{format_http_error_body, format_user_error, friendly_error_code, sanitize_error_text};
pub use fleet_placement::{fleet_capacity_score, placement_adjusted_score};
pub use k8s_top::{parse_kubectl_top_line, K8sTopRow};
pub use prometheus_remote_write::{
    decode_remote_write_body, encode_remote_write_body, encode_remote_write_v2_body,
    host_percents_from_remote_write, samples_from_write_request, write_request_v2_with_gauge,
    write_request_with_gauge, RemoteWriteDecodeResult,
};
pub use prometheus_text::{
    host_percents_from_samples, inject_peer_label, parse_prometheus_text, PrometheusSample,
};
pub use trace_context::{format_traceparent, trace_context_from_headers, HttpTraceContext};
pub use observability_settings::{
    apply_observability_patch, settings_view_from_config, AuditObservabilityView,
    MetricsHistoryRemoteView, ObservabilitySettingsPatch, ObservabilitySettingsView,
    OtlpSettingsView,
};
pub use config::{
    AuthConfig, FleetConfig, FleetPeer, HypersdkConfig, KubeVirtConfig, LdapConfig, MachinaConfig,
    OpenStackConfig, OidcConfig, OidcDefaultRole, RunAsUserConfig, SshTerminalConfig,
    SshTerminalTarget, VmCreateBackend, DEFAULT_DAEMON_PORT,
};
pub use kubevirt::{
    kubevirt_bundle_from_libvirt_vm, kubevirt_bundle_from_qcow2, resolve_guest_os, GuestOsFamily,
    KubeVirtBundle,
};
pub use openstack::{
    accept_volume_transfer, add_aggregate_host, add_image_member, add_router_interface, add_security_group,
    associate_floating_ip, attach_interface, attach_volume, backup_instance, clone_cinder_volume, connect_cloud,
    build_network_topology, connection_status_skeleton, create_cinder_volume, create_flavor, create_floating_ip,
    create_heat_stack, create_host_aggregate, create_identity_project, create_identity_user, create_lb_health_monitor,
    create_lb_listener, create_lb_member, create_lb_pool, create_load_balancer,
    create_instance, create_keypair, create_network, create_port, create_router, create_security_group,
    create_security_group_rule, create_server_group, create_subnet, create_volume_from_image,
    create_volume_from_snapshot, create_volume_transfer, default_cloud_from_yaml, delete_cinder_snapshot,
    delete_cinder_volume, delete_flavor, delete_floating_ip,     delete_glance_image, delete_image_member,
    delete_heat_stack, delete_instance, delete_keypair, delete_lb_health_monitor, delete_lb_listener,
    delete_lb_member, delete_lb_pool, delete_load_balancer, delete_network, delete_port, delete_router, delete_security_group,
    delete_security_group_rule, delete_server_group, delete_subnet, delete_volume_transfer, detach_interface,
    detach_volume, dissociate_floating_ip, effective_cloud_name_for_config, enrich_instance_flavor,
    export_instance_plan, export_instance_to_disk, extend_cinder_volume, force_delete_instance,
    get_cinder_snapshot, get_cinder_volume, get_console_output, get_flavor, get_floating_ip, get_heat_stack,
    get_heat_stack_template, get_hypervisor, get_identity_project, get_identity_user, get_image, get_instance, get_load_balancer, get_network, get_port, get_quota_summary, get_remote_console, get_router,
    get_security_group, get_server_group, get_subnet, get_volume_transfer, instance_stack_hint,
    is_openstack_configured, issue_console_token, list_availability_zones, list_compute_services,
    grant_role_assignment,
    list_configured_clouds, list_flavors, list_floating_ips, list_heat_stack_events, list_heat_stack_resources,
    list_heat_stacks, list_host_aggregates,
    list_hypervisors, list_identity_projects, list_identity_roles, list_identity_users, list_image_members, list_images, list_instance_interfaces, list_cinder_snapshots, list_cinder_volumes,
    list_instance_floating_ips, list_instance_volumes, list_instances, list_keypairs, list_lb_health_monitors,
    list_lb_listeners, list_lb_members, list_lb_pools, list_load_balancers,
    list_networks,
    ListInstancesParams, ListInstancesResult,
    list_neutron_agents, list_ports, list_role_assignments, list_routers, list_security_groups, list_server_groups, list_subnets,
    list_volume_transfers, list_volume_types, libvirt_openstack_push_preview, libvirt_root_disk_path,
    lock_instance, migrate_instance, pause_instance, preview_qcow2_upload, pull_glance_image_to_disk,
    reboot_instance, rebuild_instance, remote_console_with_tunnel,     remove_aggregate_host, remove_router_interface,
    remove_security_group, rename_instance, reset_instance_state, retype_cinder_volume, rescue_instance,
    revoke_role_assignment,
    confirm_resize_instance, resize_instance, revert_resize_instance, resolve_clouds_yaml_path,
    resolve_console_token, resume_instance, set_compute_service_state, set_hypervisor_maintenance,
    set_neutron_agent_admin, set_volume_bootable, shelve_instance, snapshot_cinder_volume, snapshot_instance,
    start_instance, stop_instance, suspend_instance, test_connection, unlock_instance, unrescue_instance,
    unpause_instance, unshelve_instance, update_cinder_volume, update_heat_stack, update_host_aggregate, update_identity_user, update_image_metadata,
    update_image_visibility, update_instance_metadata, update_network, update_port, update_quotas, update_router,
    update_subnet, upload_qcow2_to_glance, upload_volume_to_image, UploadVolumeToImageRequest,
    UploadVolumeToImageResponse, UpdateSubnetRequest,
    AcceptVolumeTransferRequest, AddImageMemberRequest, AddRouterInterfaceRequest,
    AssociateFloatingIpRequest, AttachInterfaceRequest, AttachVolumeRequest, BackupInstanceRequest,
    CloneVolumeRequest, CreateAggregateRequest, CreateFlavorRequest, CreateFloatingIpRequest, CreatePortRequest,
    CreateServerGroupRequest, CreateVolumeFromImageRequest, CreateVolumeTransferRequest, OpenStackPortCreated,
    RemoveRouterInterfaceRequest, SetComputeServiceRequest, UpdateAggregateRequest, UpdateNetworkRequest,
    UpdatePortRequest, UpdateQuotasRequest, UpdateRouterRequest, UpdateVolumeRequest,
    CreateInstanceRequest, CreateInstanceResponse, CreateKeypairRequest,
    CreateNetworkRequest as OpenStackCreateNetworkRequest,
    CreateRouterRequest as OpenStackCreateRouterRequest,
    CreateSecurityGroupRequest, CreateSubnetRequest as OpenStackCreateSubnetRequest,
    CreateVolumeFromSnapshotRequest, RetypeVolumeRequest, RenameInstanceRequest,
    UpdateImageMetadataRequest, UpdateImageVisibilityRequest, CreateSecurityGroupRuleRequest,
    ExtendVolumeRequest, GlancePullRequest, GlancePullResult, GlanceUploadPreview, GlanceUploadRequest,
    GlanceUploadResult, LibvirtOpenStackPushPreview, MigrateInstanceRequest, OpenStackAttachedVolume,
    OpenStackAvailabilityZone, OpenStackCloudEntry, OpenStackComputeService, OpenStackConnectionStatus,
    OpenStackConsoleOutput, OpenStackExportPlan,     OpenStackFlavor, OpenStackFloatingIp, OpenStackHeatEvent, OpenStackHeatOutput, OpenStackHeatResource, OpenStackHeatStack, OpenStackHostAggregate,
    OpenStackHypervisor, OpenStackIdentityUser, OpenStackImage, OpenStackImageMember, OpenStackInstance,
    OpenStackInstanceInterface, OpenStackKeyPair, OpenStackLbHealthMonitor, OpenStackLbListener, OpenStackLbMember, OpenStackLbPool, OpenStackLoadBalancer, OpenStackCreateVolumeRequest, OpenStackNeutronAgent, OpenStackNetwork, OpenStackPort,
    OpenStackQuotaSummary, OpenStackProject, OpenStackRole, OpenStackRoleAssignment, OpenStackVolumeSnapshot, OpenStackVolumeTransfer, OpenStackRemoteConsole,
    OpenStackRouter, OpenStackSecurityGroup, OpenStackSecurityGroupRule, OpenStackServerGroup,
    OpenStackSubnet, OpenStackVolumeType, NetworkTopologyGraph, TopologyEdge, TopologyNode,
    RebuildInstanceRequest, RescueInstanceRequest,
    CreateHeatStackRequest, CreateLoadBalancerRequest, CreateLbHealthMonitorRequest, CreateLbListenerRequest,
    CreateLbMemberRequest, CreateLbPoolRequest, CreateIdentityProjectRequest, CreateIdentityUserRequest,
    RoleAssignmentRequest, UpdateHeatStackRequest, UpdateIdentityUserRequest,
    probe_heat_reachable, probe_octavia_reachable,
    ResizeInstanceRequest, SnapshotVolumeRequest, UpdateMetadataRequest,
};
pub use libvirt::{LibvirtManager, LibvirtTarget};
pub use state::{
    AppState, AttachDiskRequest, AuditEvent, BackupInfo, BackupRequest, CloneVmRequest,
    ConfirmationDialog, CreateNetworkRequest, CreateSnapshotRequest, CreateVmRequest,
    CreateVolumeRequest, DashboardStats, DiskInfo, Focus, InputMode, InterfaceInfo, NetworkInfo,
    NodeInfo, NotifyLevel, ObjectTab, RenameVmRequest, ResourceView, RestoreRequest,
    OpenStackCreateStep, OpenStackCreateWizard, SidebarCategory, SidebarItem, SnapshotInfo,
    SortColumn, SortDirection, StoragePoolInfo, StorageVolumeInfo, ViewMode, VmDetails, VmInfo,
    VmBlockDeviceMetrics, VmMetrics, VmNetDeviceMetrics, VmTemplate,
};

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
