// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use super::adapters::{firewalld, ufw};
use super::detect::detect_backend;
use super::diff::compute_diff;
use super::inventory::gather_firewall_inventory;
use super::profiles::profile_by_name;
use super::types::{
    FirewallBackend, FirewallPlanRequest, FirewallPlanResult, FirewallRule, StealthLevel,
};
use crate::LibvirtError;

pub fn compile_profile_plan(
    hostname: &str,
    req: &FirewallPlanRequest,
) -> Result<FirewallPlanResult, LibvirtError> {
    let current = gather_firewall_inventory(hostname)?;
    let enabled = req.enable.unwrap_or(true);

    if !enabled {
        let backend = detect_backend();
        let mut operations = match backend {
            FirewallBackend::Ufw => vec!["ufw --force disable".into()],
            FirewallBackend::Firewalld => vec![
                "firewall-cmd --panic-on".into(),
                "firewall-cmd --reload".into(),
            ],
            _ => vec!["iptables -P INPUT ACCEPT".into()],
        };
        if let Some(stealth) = req.stealth_level {
            operations.push(format!("zeus-stealth:{stealth:?}"));
        }
        let diff = compute_diff(&current.rules, &[]);
        return Ok(FirewallPlanResult { diff, operations });
    }

    let profile_name = req
        .profile
        .clone()
        .or_else(|| req.preset.clone())
        .unwrap_or_else(|| "ProductionServer".into());
    let profile = profile_by_name(&profile_name)
        .ok_or_else(|| LibvirtError::Invalid(format!("Unknown profile: {profile_name}")))?;

    let mut operations = Vec::new();
    let backend = detect_backend();
    match backend {
        FirewallBackend::Ufw => {
            operations.extend(ufw::apply_profile_ops(&profile.name, true)?);
        }
        FirewallBackend::Firewalld => {
            operations.extend(firewalld::apply_profile_ops(&profile.name, true)?);
        }
        _ => {
            operations.push("iptables -P INPUT DROP".into());
            for rule in &profile.rules {
                operations.push(format!(
                    "iptables -A INPUT -p {} --dport {} -j ACCEPT",
                    rule.protocol, rule.ports
                ));
            }
        }
    }

    if let Some(stealth) = req.stealth_level {
        operations.push(format!("zeus-stealth:{stealth:?}"));
    }
    if profile.name == "EmergencyIsolation" {
        operations.push("zeus-lockdown:enable".into());
        operations.push("packetwolf:capture:start".into());
    }

    let after_rules: Vec<FirewallRule> = profile
        .rules
        .iter()
        .enumerate()
        .map(|(i, r)| FirewallRule {
            id: format!("plan-{i}"),
            direction: r.direction.clone(),
            protocol: r.protocol.clone(),
            ports: r.ports.clone(),
            sources: r.sources.clone(),
            targets: vec![],
            action: r.action.clone(),
            temporary: false,
            expires_at: None,
            description: Some(r.name.clone()),
            scope: "host".into(),
            backend_ref: None,
        })
        .collect();

    let diff = compute_diff(&current.rules, &after_rules);
    Ok(FirewallPlanResult { diff, operations })
}

pub fn apply_plan(
    hostname: &str,
    req: &FirewallPlanRequest,
) -> Result<FirewallPlanResult, LibvirtError> {
    let plan = compile_profile_plan(hostname, req)?;
    if req.dry_run {
        return Ok(plan);
    }
    for op in &plan.operations {
        if op.starts_with("zeus-") || op.starts_with("packetwolf:") {
            continue;
        }
        let parts: Vec<&str> = op.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let bin = parts[0];
        let args: Vec<&str> = parts[1..].to_vec();
        std::process::Command::new(bin)
            .args(&args)
            .status()
            .map_err(LibvirtError::map_op(&format!("apply {op}")))?;
    }
    Ok(plan)
}

pub fn preset_operations(preset: &str) -> Vec<String> {
    match preset {
        "allow_ssh" => vec!["ufw allow from 10.0.0.0/8 to any port 22".into()],
        "allow_web" => vec!["ufw allow 80/tcp".into(), "ufw allow 443/tcp".into()],
        "allow_database" => vec!["ufw allow from 10.0.0.0/8 to any port 5432".into()],
        "block_all_incoming" => vec!["ufw default deny incoming".into()],
        "stealth_standard" => vec!["zeus-stealth:Standard".into()],
        _ => vec![],
    }
}

pub fn stealth_level_from_str(s: &str) -> StealthLevel {
    match s.to_ascii_lowercase().as_str() {
        "standard" => StealthLevel::Standard,
        "strict" => StealthLevel::Strict,
        "emergency" => StealthLevel::Emergency,
        _ => StealthLevel::Off,
    }
}
