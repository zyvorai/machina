// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

pub mod apikeys;
mod ai;
mod applications;
mod audit;
mod backups;
mod backup_targets;
mod baremetal;
mod blueprints;
mod cluster;
mod content;
pub mod cpu_compat;
mod enrollment;
mod enterprise_security;
mod error;
mod events;
mod fence;
mod fleet;
mod guestkit;
mod zeus_firewall;
mod zeus_security;
mod ha;
mod health;
mod health_check;
mod host_os;
mod hosts;
mod maintenance;
mod marketplace;
mod metrics;
mod migration_jobs;
mod networks;
mod network_segments;
mod notifications;
mod operations;
mod developer;
mod observability;
mod observability_middleware;
mod oidc;
mod placement;
mod policy;
mod projects;
mod recommendations;
mod reports;
mod snapshots;
mod sse;
mod storage;
mod storage_tiers;
mod support;
mod tasks;
mod templates;
mod topology;
mod upgrade;
mod users;
mod vms;
mod webhooks;

use axum::middleware;
use axum::routing::{delete, get, patch, post};
use axum::Router;

use crate::auth::auth_middleware;
use crate::console;
use crate::rate_limit::{rate_limit_middleware, RateLimiter};
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let rate_limiter = RateLimiter::new(300);
    let protected = Router::new()
        .route(
            "/api/v1/enrollment/tokens",
            get(enrollment::list_enrollment_tokens).post(enrollment::create_enrollment_token),
        )
        .route("/api/v1/hosts", get(hosts::list_hosts).post(hosts::create_host))
        .route("/api/v1/hosts/sync-all", post(hosts::sync_all_hosts))
        .route(
            "/api/v1/hosts/{id}",
            get(hosts::get_host)
                .patch(hosts::patch_host)
                .delete(hosts::delete_host),
        )
        .route("/api/v1/hosts/{id}/detail", get(hosts::get_host_detail))
        .route("/api/v1/hosts/{id}/validate", get(hosts::validate_host).post(hosts::enqueue_validate_host))
        .route("/api/v1/hosts/{id}/sync", post(hosts::sync_host))
        .route("/api/v1/hosts/{id}/lldp", get(hosts::host_lldp))
        .route("/api/v1/hosts/{id}/linux/observability", get(host_os::host_linux_observability))
        .route("/api/v1/hosts/{id}/linux/network-diag", get(host_os::host_network_diagnostics))
        .route("/api/v1/hosts/{id}/linux/audit", get(host_os::host_linux_audit))
        .route("/api/v1/hosts/{id}/diagnose", post(host_os::diagnose_host))
        .route("/api/v1/hosts/{id}/maintenance", post(hosts::host_maintenance))
        .route("/api/v1/vms", get(vms::list_vms).post(vms::create_vm))
        .route("/api/v1/vms/prune-missing", post(vms::prune_missing_vms))
        .route(
            "/api/v1/enrollment/tokens/{token}",
            delete(enrollment::revoke_enrollment_token),
        )
        .route("/api/v1/hosts/{id}/fence", post(maintenance::fence_host_manual))
        .route("/api/v1/vms/{id}", get(vms::get_vm).patch(vms::patch_vm))
        .route("/api/v1/vms/{id}/disks", get(vms::list_vm_disks))
        .route("/api/v1/vms/{id}/disks/attach", post(vms::attach_vm_disk))
        .route("/api/v1/vms/{id}/metrics", get(vms::get_vm_metrics))
        .route("/api/v1/vms/{id}/adopt", post(vms::adopt_vm))
        .route("/api/v1/vms/{id}/health-check", post(health_check::vm_health_check))
        .route("/api/v1/vms/{id}/guest/health", get(host_os::vm_guest_health))
        .route("/api/v1/vms/{id}/guest/services", get(host_os::vm_guest_services))
        .route("/api/v1/vms/{id}/diagnose", post(host_os::diagnose_vm))
        .route("/api/v1/vms/{id}/doctor", get(ai::vm_doctor))
        .route("/api/v1/ai/settings", get(ai::get_settings).patch(ai::patch_settings))
        .route("/api/v1/ai/spotlight", post(ai::spotlight))
        .route("/api/v1/ai/jarvis/landing", get(ai::jarvis_landing))
        .route("/api/v1/ai/copilot/chat", post(ai::copilot_chat))
        .route("/api/v1/ai/copilot/stream", post(ai::copilot_stream))
        .route("/api/v1/ai/explain", post(ai::explain))
        .route("/api/v1/ai/runbook", post(ai::runbook))
        .route("/api/v1/ai/blueprints/generate", post(ai::generate_blueprint))
        .route("/api/v1/ai/cost", get(ai::cost_guardian))
        .route("/api/v1/ai/cost/export.csv", get(ai::cost_export_csv))
        .route("/api/v1/ai/capacity", get(ai::capacity_planner))
        .route("/api/v1/ai/capacity/export.csv", get(ai::capacity_export_csv))
        .route("/api/v1/ai/fleet/summary", get(ai::fleet_summary))
        .route("/api/v1/ai/fleet/local", get(ai::fleet_local))
        .route("/api/v1/ai/twin/graph", get(ai::twin_graph))
        .route("/api/v1/ai/twin/impact", post(ai::twin_impact))
        .route("/api/v1/ai/incidents/analyze", get(ai::analyze_incident))
        .route("/api/v1/ai/intent/environment", post(ai::intent_environment))
        .route("/api/v1/ai/intent/environment/execute", post(ai::intent_environment_execute))
        .route("/api/v1/ai/sre/forecast", get(ai::sre_forecast))
        .route("/api/v1/ai/sre/remediate", get(ai::sre_remediate))
        .route("/api/v1/ai/compliance/remediate", get(ai::compliance_remediate))
        .route("/api/v1/ai/zeus/summary", get(ai::zeus_summary))
        .route("/api/v1/ai/fleet/power/optimize", get(ai::fleet_power_optimize))
        .route("/api/v1/ai/fleet/heatmap", get(ai::fleet_heatmap))
        .route("/api/v1/ai/fleet/rebalance/propose", get(ai::fleet_rebalance_propose))
        .route("/api/v1/ai/fleet/rebalance/execute", post(ai::fleet_rebalance_execute))
        .route("/api/v1/ai/cost/attribution", get(ai::cost_attribution))
        .route("/api/v1/ai/compliance/frameworks", get(ai::compliance_frameworks))
        .route("/api/v1/ai/security/graph", get(ai::security_graph))
        .route("/api/v1/ai/security/attack-path", post(ai::security_attack_path))
        .route("/api/v1/ai/knowledge/search", post(ai::knowledge_search))
        .route("/api/v1/ai/services/graph", get(ai::service_graph))
        .route("/api/v1/ai/memory/incidents", get(ai::infrastructure_memory))
        .route("/api/v1/ai/mission/stack", post(ai::mission_stack))
        .route("/api/v1/ai/mission/stack/execute", post(ai::mission_stack_execute))
        .route("/api/v1/ai/cost/attribution/export.csv", get(ai::cost_attribution_export_csv))
        .route("/api/v1/ai/fleet/gpu-placement", get(ai::fleet_gpu_placement))
        .route("/api/v1/ai/knowledge/diagnose", post(ai::knowledge_diagnose))
        .route("/api/v1/ai/services/impact", post(ai::service_impact))
        .route("/api/v1/ai/memory/similar", get(ai::memory_similar))
        .route("/api/v1/ai/remediate/hub", get(ai::remediate_hub))
        .route("/api/v1/ai/knowledge/runbook", post(ai::knowledge_runbook))
        .route("/api/v1/ai/cost/budget", get(ai::cost_budget))
        .route("/api/v1/ai/mission/stack/status", get(ai::mission_stack_status))
        .route("/api/v1/ai/providers", get(ai::list_ai_providers).post(ai::create_ai_provider))
        .route(
            "/api/v1/ai/providers/{id}",
            patch(ai::patch_ai_provider).delete(ai::delete_ai_provider),
        )
        .route("/api/v1/ai/providers/{id}/models", get(ai::list_ai_provider_models))
        .route("/api/v1/ai/providers/{id}/test", post(ai::test_ai_provider))
        .route("/api/v1/ai/routing/rules", get(ai::list_routing_rules))
        .route("/api/v1/ai/agents", get(ai::list_zeus_agents))
        .route("/api/v1/ai/zeus/chat", post(ai::zeus_chat))
        .route("/api/v1/ai/prompts", get(ai::list_ai_prompts).post(ai::create_ai_prompt))
        .route(
            "/api/v1/ai/prompts/{id}",
            patch(ai::patch_ai_prompt).delete(ai::delete_ai_prompt),
        )
        .route("/api/v1/ai/memory/settings", get(ai::get_memory_settings).patch(ai::patch_memory_settings))
        .route("/api/v1/ai/memory", delete(ai::purge_memory))
        .route("/api/v1/ai/actions/hub", get(ai::zeus_approval_hub))
        .route("/api/v1/ai/actions", post(ai::create_zeus_action))
        .route("/api/v1/ai/actions/{id}/execute", post(ai::execute_zeus_action))
        .route("/api/v1/ai/actions/{id}/reject", post(ai::reject_zeus_action))
        .route("/api/v1/ai/marketplace/agents", get(ai::list_agent_marketplace))
        .route(
            "/api/v1/ai/marketplace/agents/{slug}/install",
            post(ai::install_agent_marketplace),
        )
        .route(
            "/api/v1/ai/marketplace/agents/{slug}/uninstall",
            post(ai::uninstall_agent_marketplace),
        )
        .route("/api/v1/ai/enterprise/zeus", get(ai::zeus_enterprise_overview))
        .route("/api/v1/ai/zeus/plan", post(ai::zeus_autonomous_plan))
        .route("/api/v1/ai/zeus/execute", post(ai::zeus_autonomous_execute))
        .route("/api/v1/baremetal/servers", get(baremetal::list_servers).post(baremetal::register_server))
        .route("/api/v1/baremetal/servers/{id}/power", post(baremetal::server_power))
        .route("/api/v1/baremetal/servers/{id}/provision", get(baremetal::server_provision))
        .route("/api/v1/baremetal/capacity/plan", post(baremetal::capacity_plan))
        .route("/api/v1/ai/security", get(ai::security_sentinel))
        .route("/api/v1/ai/policy/export", get(ai::policy_export))
        .route("/api/v1/ai/autopilot/propose", get(ai::autopilot_propose))
        .route("/api/v1/ai/autopilot/execute", post(ai::autopilot_execute))
        .route("/api/v1/ai/autopilot/run", post(ai::autopilot_run))
        .route("/api/v1/ai/autopilot/history", get(ai::autopilot_history))
        .route("/api/v1/ai/compliance", get(ai::compliance_report))
        .route("/api/v1/ai/compliance/export", get(ai::compliance_export_html))
        .route("/api/v1/ai/compliance/export.pdf", get(ai::compliance_export_pdf))
        .route("/api/v1/ai/terminal/suggest", post(ai::terminal_suggest))
        .route("/api/v1/ai/network/explain", post(ai::network_explain))
        .route("/api/v1/migrations/advisor", get(ai::migration_advisor))
        .route("/api/v1/guestkit/status", get(guestkit::guestkit_status))
        .route("/api/v1/guestkit/doctor", post(guestkit::guestkit_doctor))
        .route("/api/v1/guestkit/migrate-plan", post(guestkit::guestkit_migrate_plan))
        .route("/api/v1/guestkit/vms/{id}/doctor", get(guestkit::guestkit_vm_doctor))
        .route("/api/v1/guestkit/jobs", post(guestkit::guestkit_submit_job))
        .route("/api/v1/guestkit/jobs/{id}", get(guestkit::guestkit_job_status))
        .route("/api/v1/zeus-firewall/status", get(zeus_firewall::status))
        .route("/api/v1/zeus-firewall/overview", get(zeus_firewall::overview))
        .route("/api/v1/zeus-firewall/profiles", get(zeus_firewall::list_profiles))
        .route("/api/v1/zeus-firewall/policies", get(zeus_firewall::list_policies).post(zeus_firewall::create_policy))
        .route("/api/v1/zeus-firewall/temporary-rules", post(zeus_firewall::create_temporary_rule))
        .route("/api/v1/zeus-firewall/simulate", post(zeus_firewall::simulate))
        .route("/api/v1/zeus-firewall/approvals", get(zeus_firewall::list_approvals).post(zeus_firewall::request_risky_change))
        .route("/api/v1/zeus-firewall/approvals/{id}/approve", post(zeus_firewall::approve_change))
        .route("/api/v1/zeus-firewall/approvals/{id}/reject", post(zeus_firewall::reject_change))
        .route("/api/v1/zeus-firewall/policies/gitops/export", get(zeus_firewall::export_gitops))
        .route("/api/v1/zeus-firewall/policies/gitops/sync", post(zeus_firewall::sync_gitops))
        .route("/api/v1/zeus-firewall/k8s/status", get(zeus_firewall::k8s_status))
        .route("/api/v1/zeus-firewall/k8s/plan", post(zeus_firewall::k8s_plan))
        .route("/api/v1/zeus-firewall/k8s/apply", post(zeus_firewall::k8s_apply))
        .route("/api/v1/zeus-firewall/baremetal/overview", get(zeus_firewall::baremetal_overview))
        .route("/api/v1/zeus-firewall/baremetal/{id}/scan", post(zeus_firewall::baremetal_scan))
        .route("/api/v1/zeus-firewall/baremetal/{id}/temporary", post(zeus_firewall::baremetal_temporary))
        .route("/api/v1/zeus-firewall/finops/exposure", get(zeus_firewall::finops_exposure))
        .route(
            "/api/v1/zeus-firewall/finops/exposure/export.csv",
            get(zeus_firewall::finops_exposure_export_csv),
        )
        .route("/api/v1/zeus-firewall/cloud/overview", get(zeus_firewall::cloud_overview))
        .route("/api/v1/zeus-firewall/vms/{id}/guest-ports", get(zeus_firewall::vm_guest_ports))
        .route("/api/v1/zeus-firewall/connectivity", post(zeus_firewall::connectivity_matrix))
        .route("/api/v1/zeus-firewall/compliance/{kind}/export.pdf", get(zeus_firewall::compliance_export_pdf))
        .route("/api/v1/zeus-firewall/packetwolf/anomalies", get(zeus_firewall::packetwolf_anomalies))
        .route("/api/v1/zeus-firewall/compliance/{kind}", get(zeus_firewall::compliance_report))
        .route("/api/v1/zeus-firewall/siem/export", get(zeus_firewall::siem_export))
        .route("/api/v1/zeus-firewall/targets/{id}", get(zeus_firewall::get_target))
        .route("/api/v1/zeus-firewall/targets/{id}/ports", get(zeus_firewall::get_ports))
        .route("/api/v1/zeus-firewall/targets/{id}/services", get(zeus_firewall::get_services))
        .route("/api/v1/zeus-firewall/targets/{id}/score", get(zeus_firewall::get_score))
        .route("/api/v1/zeus-firewall/targets/{id}/plan", post(zeus_firewall::plan_target))
        .route("/api/v1/zeus-firewall/targets/{id}/apply", post(zeus_firewall::apply_target))
        .route("/api/v1/zeus-firewall/targets/{id}/timeline", get(zeus_firewall::get_timeline))
        .route("/api/v1/zeus-firewall/targets/{id}/drift", get(zeus_firewall::detect_drift))
        .route("/api/v1/zeus-firewall/targets/{id}/activity", get(zeus_firewall::get_activity))
        .route("/api/v1/zeus-firewall/targets/{id}/lockdown", post(zeus_firewall::lockdown))
        .route("/api/v1/zeus-firewall/targets/{id}/profile", post(zeus_firewall::apply_profile))
        .route("/api/v1/zeus-firewall/targets/{id}/checkpoints", get(zeus_firewall::list_checkpoints))
        .route("/api/v1/zeus-firewall/targets/{id}/rollback", post(zeus_firewall::rollback))
        .route("/api/v1/ai/firewall/explain", post(zeus_firewall::ai_explain))
        .route("/api/v1/ai/firewall/secure-plan", post(zeus_firewall::ai_secure_plan))
        .route("/api/v1/zeus-firewall/multisite/overview", get(zeus_firewall::multisite_overview))
        .route("/api/v1/zeus-firewall/multisite/export", get(zeus_firewall::multisite_export))
        .route("/api/v1/zeus-firewall/multisite/drift", get(zeus_firewall::multisite_drift))
        .route("/api/v1/zeus-firewall/multisite/connectivity", get(zeus_firewall::multisite_connectivity))
        .route("/api/v1/zeus-firewall/multisite/sync", post(zeus_firewall::multisite_sync))
        .route("/api/v1/zeus-firewall/multisite/timeline", get(zeus_firewall::multisite_timeline))
        .route("/api/v1/zeus-firewall/multisite/dr-templates", get(zeus_firewall::multisite_dr_templates))
        .route("/api/v1/zeus-firewall/operator/plan", get(zeus_firewall::operator_plan))
        .route("/api/v1/zeus-firewall/operator/execute", post(zeus_firewall::operator_execute))
        .route(
            "/api/v1/zeus-firewall/operator/execute-batch",
            post(zeus_firewall::operator_execute_batch),
        )
        .route("/api/v1/zeus-firewall/operator/thresholds", get(zeus_firewall::operator_thresholds))
        .route("/api/v1/zeus-security/status", get(zeus_security::status))
        .route("/api/v1/zeus-security/fleet/threat", get(zeus_security::fleet_threat))
        .route("/api/v1/zeus-security/sensors", get(zeus_security::sensors))
        .route("/api/v1/zeus-security/asset-inventory", get(zeus_security::asset_inventory))
        .route("/api/v1/zeus-security/fleet/timeline", get(zeus_security::fleet_timeline))
        .route("/api/v1/zeus-security/correlations", get(zeus_security::correlations))
        .route("/api/v1/zeus-security/fabric/health", get(zeus_security::fabric_health))
        .route("/api/v1/zeus-security/hunt/queries", get(zeus_security::hunt_queries))
        .route("/api/v1/zeus-security/hunt/run/{query_id}", post(zeus_security::run_hunt_query))
        .route("/api/v1/zeus-security/alerts/sync", post(zeus_security::sync_alerts))
        .route("/api/v1/zeus-security/graph", get(zeus_security::security_graph))
        .route("/api/v1/zeus-security/search", post(zeus_security::search))
        .route("/api/v1/zeus-security/hosts/{id}/summary", get(zeus_security::host_summary))
        .route("/api/v1/zeus-security/hosts/{id}/processes", get(zeus_security::host_processes))
        .route("/api/v1/zeus-security/hosts/{id}/connections", get(zeus_security::host_connections))
        .route("/api/v1/zeus-security/hosts/{id}/dns", get(zeus_security::host_dns))
        .route("/api/v1/zeus-security/hosts/{id}/files", get(zeus_security::host_files))
        .route("/api/v1/zeus-security/hosts/{id}/ports", get(zeus_security::host_ports))
        .route("/api/v1/zeus-security/hosts/{id}/containers", get(zeus_security::host_containers))
        .route("/api/v1/zeus-security/hosts/{id}/timeline", get(zeus_security::host_timeline))
        .route("/api/v1/zeus-security/hosts/{id}/process-graph", get(zeus_security::host_process_graph))
        .route("/api/v1/zeus-security/hosts/{id}/tetragon/install", post(zeus_security::install_tetragon))
        .route("/api/v1/zeus-security/k8s/{cluster_id}/tetragon/install", post(zeus_security::install_k8s_tetragon))
        .route("/api/v1/zeus-security/k8s/{cluster_id}/export-status", get(zeus_security::k8s_export_status))
        .route("/api/v1/zeus-security/enforcement/status", get(zeus_security::enforcement_status))
        .route("/api/v1/zeus-security/enforcement/policies", get(zeus_security::enforcement_policies).post(zeus_security::create_enforcement_policy))
        .route("/api/v1/zeus-security/enforcement/policies/{id}/apply", post(zeus_security::apply_enforcement_policy))
        .route("/api/v1/zeus-security/hosts/{id}/enforcement", get(zeus_security::host_enforcement))
        .route("/api/v1/zeus-security/hosts/{id}/fabric-status", get(zeus_security::host_fabric_status))
        .route("/api/v1/zeus-security/agents/{id}/bundle", get(zeus_security::agent_security_bundle))
        .route("/api/v1/ai/security/explain-event", post(zeus_security::explain_event))
        .route("/api/v1/ai/security/attack-reconstruct", post(zeus_security::attack_reconstruct))
        .route("/api/v1/ai/security/nl-search", post(zeus_security::nl_search))
        .route("/api/v1/ai/security/hunt-summary", post(zeus_security::hunt_summary))
        .route("/api/v1/hosts/{id}/health-check", post(health_check::host_health_check))
        .route("/api/v1/recommendations", get(recommendations::list_recommendations))
        .route(
            "/api/v1/applications",
            get(applications::list_applications).post(applications::create_application),
        )
        .route("/api/v1/applications/{id}", get(applications::get_application))
        .route(
            "/api/v1/applications/{id}/actions",
            post(applications::run_application_action),
        )
        .route("/api/v1/topology", get(topology::cluster_topology))
        .route("/api/v1/vms/{id}/topology", get(topology::vm_topology))
        .route("/api/v1/vms/{id}/spec", get(vms::get_vm_spec))
        .route("/api/v1/vms/{id}/start", post(vms::start_vm))
        .route("/api/v1/vms/{id}/stop", post(vms::stop_vm))
        .route("/api/v1/vms/{id}/reboot", post(vms::reboot_vm))
        .route("/api/v1/vms/{id}/delete", post(vms::delete_vm))
        .route(
            "/api/v1/vms/{id}/guest-tools/install",
            post(vms::install_guest_tools),
        )
        .route("/api/v1/vms/{id}/migrate/precheck", post(vms::migrate_precheck))
        .route("/api/v1/vms/{id}/migrate", post(vms::migrate_vm))
        .route(
            "/api/v1/vms/{id}/ha",
            get(ha::get_vm_ha_policy).post(ha::set_vm_ha_policy),
        )
        .route("/api/v1/vms/from-template", post(vms::create_from_template))
        .route("/api/v1/vms/{id}/clone", post(vms::clone_vm))
        .route("/api/v1/vms/{id}/console", get(console::vm_console))
        .route("/api/v1/vms/{id}/ws-token", post(console::issue_ws_token))
        .route(
            "/api/v1/vms/{id}/snapshots",
            get(snapshots::list_vm_snapshots).post(snapshots::create_vm_snapshot),
        )
        .route(
            "/api/v1/vms/{id}/snapshots/{name}",
            delete(snapshots::delete_vm_snapshot),
        )
        .route(
            "/api/v1/vms/{id}/snapshots/{name}/revert",
            post(snapshots::revert_vm_snapshot),
        )
        .route(
            "/api/v1/vms/{id}/snapshots/{name}/clone",
            post(snapshots::clone_vm_snapshot),
        )
        .route(
            "/api/v1/vms/{id}/backups",
            get(backups::list_vm_backups).post(backups::create_vm_backup),
        )
        .route(
            "/api/v1/backup-targets",
            get(backup_targets::list_backup_targets).post(backup_targets::create_backup_target),
        )
        .route("/api/v1/backups/timeline", get(backups::list_backup_timeline))
        .route(
            "/api/v1/vms/{id}/backups/{backup_id}/restore",
            post(backups::restore_vm_backup),
        )
        .route(
            "/api/v1/vms/{id}/migrations",
            get(migration_jobs::list_vm_migration_jobs),
        )
        .route(
            "/api/v1/templates",
            get(templates::list_templates).post(templates::create_template),
        )
        .route(
            "/api/v1/templates/marketplace",
            get(templates::list_marketplace_templates),
        )
        .route("/api/v1/marketplace/plugins", get(marketplace::plugins_overview))
        .route(
            "/api/v1/marketplace/plugins/{slug}/install",
            post(marketplace::install_plugin),
        )
        .route(
            "/api/v1/marketplace/plugins/{slug}/uninstall",
            post(marketplace::uninstall_plugin),
        )
        .route("/api/v1/marketplace/plugins", post(marketplace::publish_plugin))
        .route("/api/v1/templates/seed", post(templates::seed_templates))
        .route(
            "/api/v1/templates/{name}/{version}",
            get(templates::get_template).delete(templates::delete_template),
        )
        .route(
            "/api/v1/templates/{name}/{version}/readiness",
            get(templates::get_template_readiness),
        )
        .route(
            "/api/v1/storage/pools",
            get(storage::list_storage_pools).post(storage::create_storage_pool),
        )
        .route("/api/v1/storage/pools/discover", post(storage::discover_storage_pools))
        .route(
            "/api/v1/storage/pools/{id}",
            patch(storage::patch_storage_pool).delete(storage::delete_storage_pool),
        )
        .route("/api/v1/storage/tiers/overview", get(storage_tiers::tiers_overview))
        .route(
            "/api/v1/storage/pools/{pool_id}/tier/{tier_id}",
            post(storage_tiers::bind_pool_tier),
        )
        .route("/api/v1/storage/backup-sla", get(storage_tiers::backup_sla_overview))
        .route(
            "/api/v1/storage/pools/{id}/backup-sla",
            post(storage_tiers::upsert_backup_sla),
        )
        .route(
            "/api/v1/storage/pools/{id}/snapshot-policy",
            get(storage_tiers::pool_snapshot_policy),
        )
        .route(
            "/api/v1/networks",
            get(networks::list_networks).post(networks::create_network),
        )
        .route("/api/v1/networks/discover", post(networks::discover_networks))
        .route(
            "/api/v1/networks/{id}",
            patch(networks::patch_network).delete(networks::delete_network),
        )
        .route(
            "/api/v1/network/segments/overview",
            get(network_segments::segments_overview),
        )
        .route(
            "/api/v1/network/segments",
            post(network_segments::create_segment),
        )
        .route(
            "/api/v1/network/segments/gitops/export",
            get(network_segments::gitops_export),
        )
        .route("/api/v1/network/ipam/pools", get(network_segments::ipam_pools))
        .route(
            "/api/v1/network/segments/{id}/connectivity",
            post(network_segments::segment_connectivity),
        )
        .route(
            "/api/v1/network/segments/{id}/ipam/allocate",
            post(network_segments::ipam_allocate),
        )
        .route(
            "/api/v1/network/segments/{id}/emergency-unlock",
            post(network_segments::emergency_unlock),
        )
        .route(
            "/api/v1/network/segments/{id}/bind/{network_id}",
            post(network_segments::bind_network_to_segment),
        )
        .route("/api/v1/placement/recommendations", get(placement::list_recommendations))
        .route("/api/v1/placement/refresh", post(placement::refresh_recommendations))
        .route("/api/v1/cluster", get(cluster::get_cluster).patch(cluster::patch_cluster))
        .route("/api/v1/cluster/leadership", get(cluster::get_leadership))
        .route(
            "/api/v1/cluster/settings",
            get(cluster::get_settings).patch(cluster::patch_settings),
        )
        .route(
            "/api/v1/enterprise/security/overview",
            get(enterprise_security::overview),
        )
        .route(
            "/api/v1/enterprise/vault/providers",
            get(enterprise_security::list_vault_providers).post(enterprise_security::register_vault_provider),
        )
        .route(
            "/api/v1/enterprise/vault/providers/{id}/sync",
            post(enterprise_security::sync_vault_provider),
        )
        .route(
            "/api/v1/enterprise/vault/sync-all",
            post(enterprise_security::sync_all_vault_providers),
        )
        .route(
            "/api/v1/enterprise/mfa/policies",
            get(enterprise_security::list_mfa_policies),
        )
        .route(
            "/api/v1/enterprise/mfa/compliance",
            get(enterprise_security::mfa_compliance),
        )
        .route(
            "/api/v1/enterprise/mfa/policies/{role}",
            post(enterprise_security::upsert_mfa_policy),
        )
        .route(
            "/api/v1/enterprise/air-gap/bundles",
            get(enterprise_security::list_air_gap_bundles).post(enterprise_security::create_air_gap_bundle),
        )
        .route(
            "/api/v1/enterprise/air-gap/bundles/{id}",
            get(enterprise_security::get_air_gap_bundle),
        )
        .route(
            "/api/v1/enterprise/fips/matrix",
            get(enterprise_security::fips_matrix),
        )
        .route(
            "/api/v1/enterprise/tenants/overview",
            get(enterprise_security::tenant_isolation_overview),
        )
        .route(
            "/api/v1/enterprise/tenants/policies/{project}",
            post(enterprise_security::upsert_tenant_policy),
        )
        .route("/api/v1/ha/status", get(ha::get_ha_status))
        .route("/api/v1/migrations", get(migration_jobs::list_migration_jobs))
        .route("/api/v1/fence/events", get(fence::list_fence_events))
        .route("/api/v1/audit", get(audit::list_audit_logs))
        .route("/api/v1/tasks", get(tasks::list_tasks))
        .route("/api/v1/tasks/{id}", get(tasks::get_task))
        .route("/api/v1/tasks/{id}/cancel", post(tasks::cancel_task))
        .route("/api/v1/tasks/{id}/retry", post(tasks::retry_task))
        .route("/api/v1/events", get(events::list_events))
        .route("/api/v1/events/stream", get(sse::stream_events))
        .route(
            "/api/v1/content/images",
            get(content::list_content_images).post(content::create_content_image),
        )
        .route(
            "/api/v1/content/images/{id}/approve",
            post(content::approve_content_image),
        )
        .route(
            "/api/v1/content/images/{id}/reject",
            post(content::reject_content_image),
        )
        .route("/api/v1/users", get(users::list_users).post(users::create_user))
        .route("/api/v1/users/me", get(users::me))
        .route(
            "/api/v1/users/{id}",
            patch(users::patch_user).delete(users::delete_user),
        )
        .route("/api/v1/api-keys", get(apikeys::list_api_keys).post(apikeys::create_api_key))
        .route("/api/v1/api-keys/{id}", delete(apikeys::delete_api_key))
        .route("/api/v1/webhooks", get(webhooks::list_webhooks).post(webhooks::create_webhook))
        .route("/api/v1/webhooks/{id}", delete(webhooks::delete_webhook))
        .route("/api/v1/webhooks/{id}/toggle", post(webhooks::toggle_webhook))
        .route("/api/v1/webhook-deliveries", get(webhooks::list_webhook_deliveries))
        .route(
            "/api/v1/webhook-deliveries/{id}/retry",
            post(webhooks::retry_webhook_delivery),
        )
        .route("/api/v1/projects", get(projects::list_projects))
        .route("/api/v1/policy/rules", get(policy::list_policy_rules))
        .route("/api/v1/policy/quotas", get(policy::list_project_quotas).post(policy::upsert_project_quota))
        .route("/api/v1/support/bundle", get(support::support_bundle))
        .route("/api/v1/upgrade/matrix", get(upgrade::upgrade_matrix))
        .route("/api/v1/hosts/{id}/upgrade", post(upgrade::upgrade_host_agent))
        .route("/api/v1/reports/capacity", get(reports::capacity_report))
        .route("/api/v1/reports/finops", get(reports::finops_report))
        .route("/api/v1/operations/overview", get(operations::overview))
        .route("/api/v1/operations/runbooks", get(operations::list_runbooks))
        .route(
            "/api/v1/operations/runbooks/{incident}/execute",
            post(operations::execute_runbook),
        )
        .route("/api/v1/operations/executions", get(operations::list_executions))
        .route("/api/v1/operations/showback", get(operations::showback_overview))
        .route("/api/v1/fleet/desktop", get(fleet::desktop_overview))
        .route("/api/v1/fleet/linux-health", get(fleet::linux_health))
        .route("/api/v1/fleet/activity", get(fleet::activity_overview))
        .route("/api/v1/fleet/backups", get(fleet::backup_overview))
        .route("/api/v1/fleet/finder", get(fleet::finder_overview))
        .route("/api/v1/fleet/network", get(fleet::network_overview))
        .route("/api/v1/fleet/storage", get(fleet::storage_overview))
        .route("/api/v1/fleet/console", get(fleet::console_overview))
        .route("/api/v1/fleet/updates", get(fleet::updates_overview))
        .route("/api/v1/fleet/keychain", get(fleet::keychain_overview))
        .route("/api/v1/fleet/users", get(fleet::users_overview))
        .route("/api/v1/fleet/shortcuts", get(fleet::shortcuts_overview))
        .route("/api/v1/fleet/spaces", get(fleet::spaces_overview))
        .route("/api/v1/fleet/general", get(fleet::general_overview))
        .route("/api/v1/fleet/mission", get(fleet::mission_overview))
        .route("/api/v1/fleet/gpu", get(fleet::gpu_overview))
        .route(
            "/api/v1/fleet/maintenance-mission",
            get(fleet::maintenance_mission_overview),
        )
        .route("/api/v1/fleet/dna", get(fleet::dna_overview))
        .route("/api/v1/hosts/{id}/linux/updates", get(host_os::host_linux_package_updates))
        .route("/api/v1/ai/fleet/diagnose", post(fleet::fleet_diagnose))
        .route("/api/v1/developer/overview", get(developer::overview))
        .route("/api/v1/developer/terraform/schema", get(developer::terraform_schema))
        .route("/api/v1/observability/overview", get(observability::overview))
        .route("/api/v1/observability/traces", get(observability::list_traces))
        .route(
            "/api/v1/blueprints",
            get(blueprints::list_blueprints).post(blueprints::create_blueprint),
        )
        .route(
            "/api/v1/blueprints/{id}/run",
            post(blueprints::run_blueprint),
        )
        .route("/api/v1/blueprints/{id}", delete(blueprints::delete_blueprint))
        .route("/api/v1/metrics/prometheus", get(metrics::prometheus_metrics))
        .route(
            "/api/v1/maintenance/schedules",
            get(maintenance::list_schedules).post(maintenance::create_schedule),
        )
        .route(
            "/api/v1/maintenance/schedules/{id}",
            delete(maintenance::delete_schedule),
        )
        .route("/api/v1/notifications", get(notifications::list_notifications))
        .route(
            "/api/v1/notifications/{id}/deliver",
            post(notifications::mark_notification_delivered),
        )
        .route("/api/v1/auth/oidc", get(oidc::get_oidc_settings).patch(oidc::patch_oidc_settings))
        .route(
            "/api/v1/cpu-compat",
            get(cpu_compat::get_cpu_compat_matrix).patch(cpu_compat::patch_cpu_compat_matrix),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), observability_middleware::trace_middleware))
        .route_layer(middleware::from_fn_with_state(rate_limiter.clone(), rate_limit_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    Router::new()
        .route("/api/v1/health", get(health::health))
        .route("/api/v1/health/ready", get(health::ready))
        .route("/api/v1/openapi.json", get(health::openapi))
        .route("/api/v1/auth/oidc/login", get(oidc::oidc_login))
        .route("/api/v1/auth/oidc/redirect", get(oidc::oidc_login_redirect))
        .route("/api/v1/auth/oidc/callback", get(oidc::oidc_callback))
        .route("/api/v1/hosts/join", post(hosts::join_host))
        .route("/install.sh", get(enrollment::install_script))
        .merge(console::ws_routes())
        .merge(protected)
        .with_state(state)
}

pub use error::ApiError;
