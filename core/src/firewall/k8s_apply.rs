// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use super::detect::run_cmd;
use super::profiles::profile_by_name;
use super::types::{FirewallBackend, FirewallPlanRequest, FirewallPlanResult};
use crate::LibvirtError;

#[derive(Debug, Clone, serde::Serialize)]
pub struct K8sPolicyManifest {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub yaml: String,
}

pub fn compile_k8s_policies(
    namespace: &str,
    profile_name: &str,
) -> Result<Vec<K8sPolicyManifest>, LibvirtError> {
    let profile = profile_by_name(profile_name)
        .ok_or_else(|| LibvirtError::Invalid(format!("Unknown profile: {profile_name}")))?;
    let safe_ns = if namespace.is_empty() {
        "default"
    } else {
        namespace
    };
    let safe_name = format!(
        "zeus-{}",
        profile_name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            })
            .collect::<String>()
    );

    let mut ingress = Vec::new();
    for rule in &profile.rules {
        if rule.direction != "inbound" || rule.action != "allow" {
            continue;
        }
        let from = if rule.sources.is_empty() || rule.sources.iter().any(|s| s == "any") {
            "- ipBlock:\n      cidr: 0.0.0.0/0".to_string()
        } else {
            rule.sources
                .iter()
                .map(|s| format!("- ipBlock:\n      cidr: {s}"))
                .collect::<Vec<_>>()
                .join("\n    ")
        };
        let port_block = if rule.ports == "*" {
            String::new()
        } else {
            format!(
                "\n        - protocol: {}\n          port: {}",
                rule.protocol.to_uppercase(),
                rule.ports
            )
        };
        ingress.push(format!("    - from:\n    {from}\n      ports:{port_block}"));
    }

    let np_yaml = format!(
        "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: {safe_name}\n  namespace: {safe_ns}\n  labels:\n    app.kubernetes.io/managed-by: zeus-firewall\nspec:\n  podSelector: {{}}\n  policyTypes:\n  - Ingress\n  ingress:\n{}\n",
        ingress.join("\n")
    );

    let cnp_yaml = format!(
        "apiVersion: cilium.io/v2\nkind: CiliumNetworkPolicy\nmetadata:\n  name: {safe_name}\n  namespace: {safe_ns}\n  labels:\n    app.kubernetes.io/managed-by: zeus-firewall\nspec:\n  endpointSelector: {{}}\n  ingress:\n  - fromEntities:\n    - cluster\n  - toPorts:\n    - ports:\n      - port: \"22\"\n        protocol: TCP\n",
    );

    Ok(vec![
        K8sPolicyManifest {
            kind: "NetworkPolicy".into(),
            namespace: safe_ns.into(),
            name: safe_name.clone(),
            yaml: np_yaml,
        },
        K8sPolicyManifest {
            kind: "CiliumNetworkPolicy".into(),
            namespace: safe_ns.into(),
            name: safe_name,
            yaml: cnp_yaml,
        },
    ])
}

pub fn apply_k8s_plan(
    namespace: &str,
    req: &FirewallPlanRequest,
) -> Result<FirewallPlanResult, LibvirtError> {
    let profile = req
        .profile
        .clone()
        .or_else(|| req.preset.clone())
        .unwrap_or_else(|| "ProductionServer".into());
    let manifests = compile_k8s_policies(namespace, &profile)?;
    let mut operations = Vec::new();
    for m in &manifests {
        operations.push(format!("kubectl apply -f - <<'EOF'\n{}\nEOF", m.yaml));
    }
    if req.dry_run {
        return Ok(FirewallPlanResult {
            diff: super::diff::compute_diff(&[], &[]),
            operations,
        });
    }
    for m in &manifests {
        let status = std::process::Command::new("kubectl")
            .args(["apply", "-f", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(stdin) = child.stdin.as_mut() {
                    stdin.write_all(m.yaml.as_bytes())?;
                }
                child.wait()
            })
            .map_err(LibvirtError::map_op("kubectl apply"))?;
        if !status.success() {
            return Err(LibvirtError::Operation(format!(
                "kubectl apply failed for {}",
                m.name
            )));
        }
    }
    Ok(FirewallPlanResult {
        diff: super::diff::compute_diff(&[], &[]),
        operations,
    })
}

pub fn k8s_cluster_ready() -> bool {
    run_cmd("kubectl", &["version", "--client"]).is_ok()
        && run_cmd("kubectl", &["get", "nodes", "--request-timeout=5s"]).is_ok()
}

pub fn detect_k8s_backend() -> FirewallBackend {
    if run_cmd(
        "kubectl",
        &["get", "ciliumnetworkpolicies", "-A", "--request-timeout=3s"],
    )
    .is_ok()
    {
        FirewallBackend::Cilium
    } else if run_cmd(
        "kubectl",
        &["get", "networkpolicy", "-A", "--request-timeout=3s"],
    )
    .is_ok()
    {
        FirewallBackend::K8sNetworkPolicy
    } else {
        FirewallBackend::Unknown
    }
}
