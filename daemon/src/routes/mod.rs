// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

mod advanced;
mod automation;
mod backup;
mod console;
pub mod consolehub;
pub(crate) mod events;
mod extras;
mod fleet;
mod guacamole;
mod guest_images;
mod guestkit;
mod health;
mod host_network;
mod hypersdk;
mod integrations;
mod jobs;
mod k8s;
mod kubevirt;
mod metrics;
mod networks;
mod node;
mod openstack;
mod openstack_extended;
mod openstack_services;
mod platform_controller;
mod platform_ws;
mod prometheus;
mod snapshots;
mod storage;
mod system;
mod templates;
mod vm_guest;
mod vms;
mod ws;
mod zeus_firewall;

use axum::Router;
use machina_core::LibvirtManager;

pub fn api_routes() -> Router<LibvirtManager> {
    Router::new()
        .merge(events::event_routes())
        .merge(jobs::job_routes())
        .merge(k8s::k8s_routes())
        .merge(kubevirt::kubevirt_routes())
        .merge(openstack::openstack_routes())
        .merge(integrations::integrations_routes())
        .merge(hypersdk::hypersdk_routes())
        .merge(guestkit::guestkit_routes())
        .merge(zeus_firewall::zeus_firewall_routes())
        .merge(platform_controller::platform_controller_routes())
        .merge(vms::vm_routes())
        .merge(vm_guest::vm_guest_routes())
        .merge(snapshots::snapshot_routes())
        .merge(networks::network_routes())
        .merge(storage::storage_routes())
        .merge(node::node_routes())
        .merge(metrics::metrics_routes())
        .merge(health::health_routes())
        .merge(guest_images::guest_image_routes())
        .merge(templates::template_routes())
        .merge(prometheus::prometheus_routes())
        .merge(console::console_routes())
        .merge(consolehub::api_routes())
        .merge(guacamole::guacamole_routes())
        .merge(advanced::advanced_routes())
        .merge(backup::backup_routes())
        .merge(host_network::host_network_routes())
        .merge(extras::extras_routes())
        .merge(automation::automation_routes())
        .merge(system::system_routes())
        .merge(fleet::fleet_routes())
}

pub fn websocket_routes() -> Router<LibvirtManager> {
    Router::new()
        .merge(ws::ws_routes())
        .merge(platform_ws::platform_ws_routes())
}

pub fn consolehub_proxy_routes() -> axum::Router {
    consolehub::proxy_routes()
}
