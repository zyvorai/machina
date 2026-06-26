// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Helm-based Tetragon install + PacketWolf export forwarder for Kubernetes clusters.

use std::io::Write;
use std::process::{Command, Output, Stdio};

use crate::config::ControllerConfig;

const FORWARDER_TEMPLATE: &str =
    include_str!("../../../contrib/k8s/packetwolf-export-forwarder.yaml");
const FORWARD_SCRIPT: &str = include_str!("../../../contrib/k8s/packetwolf-export-forward.py");

pub struct K8sTetragonInstallResult {
    pub ok: bool,
    pub helm_output: String,
    pub forwarder_applied: bool,
    pub forwarder_output: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct K8sExportForwarderStatus {
    pub cluster_id: String,
    pub host_id: String,
    pub namespace: String,
    pub forwarder_deployed: bool,
    pub ready_replicas: u32,
    pub export_url: String,
    pub message: String,
}

fn helm_available() -> bool {
    Command::new("helm")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn kubectl_available() -> bool {
    Command::new("kubectl")
        .args(["version", "--client"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn k8s_name_token(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').chars().take(48).collect()
}

fn packetwolf_export_url(cfg: &ControllerConfig) -> String {
    if cfg.packetwolf_enabled {
        format!(
            "{}/api/v1/ingest",
            cfg.packetwolf_base_url.trim_end_matches('/')
        )
    } else {
        "http://127.0.0.1:9091/api/v1/ingest".into()
    }
}

fn indent_configmap_script(src: &str) -> String {
    src.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn render_export_forwarder_manifest(
    cfg: &ControllerConfig,
    cluster_id: &str,
    namespace: &str,
) -> String {
    let token = k8s_name_token(cluster_id);
    let host_id = format!("k8s-{cluster_id}");
    // Strip newlines/colons from api_key to prevent YAML structure injection via template replace.
    let raw_key = cfg.packetwolf_api_key.as_deref().unwrap_or("");
    let api_key = raw_key.replace(['\n', '\r', ':'], "");
    FORWARDER_TEMPLATE
        .replace("{{NAMESPACE}}", namespace)
        .replace("{{CLUSTER_TOKEN}}", &token)
        .replace("{{HOST_ID}}", &host_id)
        .replace("{{EXPORT_URL}}", &packetwolf_export_url(cfg))
        .replace("{{API_KEY}}", &api_key)
        .replace(
            "{{FORWARD_SCRIPT}}",
            &indent_configmap_script(FORWARD_SCRIPT),
        )
}

fn kubectl_apply(manifest: &str) -> Result<Output, std::io::Error> {
    let mut child = Command::new("kubectl")
        .args(["apply", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(manifest.as_bytes())?;
    }
    child.wait_with_output()
}

pub fn apply_export_forwarder(
    cfg: &ControllerConfig,
    cluster_id: &str,
    namespace: &str,
) -> Result<String, String> {
    if !kubectl_available() {
        return Err("kubectl not found on controller — export forwarder not applied".into());
    }
    let manifest = render_export_forwarder_manifest(cfg, cluster_id, namespace);
    let output = kubectl_apply(&manifest).map_err(|e| format!("kubectl apply failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let combined = format!("{stdout}{stderr}").trim().to_string();
    if output.status.success() {
        Ok(combined)
    } else {
        Err(if combined.is_empty() {
            "kubectl apply failed".into()
        } else {
            combined
        })
    }
}

pub fn export_forwarder_status(
    cfg: &ControllerConfig,
    cluster_id: &str,
    namespace: &str,
) -> K8sExportForwarderStatus {
    let host_id = format!("k8s-{cluster_id}");
    let export_url = packetwolf_export_url(cfg);
    if !kubectl_available() {
        return K8sExportForwarderStatus {
            cluster_id: cluster_id.into(),
            host_id,
            namespace: namespace.into(),
            forwarder_deployed: false,
            ready_replicas: 0,
            export_url,
            message: "kubectl not available".into(),
        };
    }
    let output = Command::new("kubectl")
        .args([
            "get",
            "deployment",
            "packetwolf-export-forwarder",
            "-n",
            namespace,
            "-o",
            "jsonpath={.status.readyReplicas}",
            "--request-timeout=5s",
        ])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let ready = String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u32>()
                .unwrap_or(0);
            K8sExportForwarderStatus {
                cluster_id: cluster_id.into(),
                host_id,
                namespace: namespace.into(),
                forwarder_deployed: true,
                ready_replicas: ready,
                export_url,
                message: if ready > 0 {
                    format!("Export forwarder running ({ready} ready replica(s))")
                } else {
                    "Export forwarder deployed but not ready".into()
                },
            }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            K8sExportForwarderStatus {
                cluster_id: cluster_id.into(),
                host_id,
                namespace: namespace.into(),
                forwarder_deployed: false,
                ready_replicas: 0,
                export_url,
                message: if stderr.is_empty() {
                    "Export forwarder not deployed".into()
                } else {
                    stderr
                },
            }
        }
        Err(e) => K8sExportForwarderStatus {
            cluster_id: cluster_id.into(),
            host_id,
            namespace: namespace.into(),
            forwarder_deployed: false,
            ready_replicas: 0,
            export_url,
            message: format!("kubectl status failed: {e}"),
        },
    }
}

pub fn install_tetragon_helm(
    cfg: &ControllerConfig,
    cluster_id: &str,
    namespace: &str,
    cluster_name: &str,
) -> K8sTetragonInstallResult {
    if !helm_available() {
        return K8sTetragonInstallResult {
            ok: false,
            helm_output: String::new(),
            forwarder_applied: false,
            forwarder_output: String::new(),
            message:
                "helm not found on controller — install Helm CLI or run enrollment from a bastion"
                    .into(),
        };
    }

    let export_url = packetwolf_export_url(cfg);

    let _ = Command::new("helm")
        .args(["repo", "add", "cilium", "https://helm.cilium.io/"])
        .output();
    let _ = Command::new("helm")
        .args(["repo", "update", "cilium"])
        .output();

    let values = "tetragon.enabled=true,tetragon.export.stdout.enabled=true,tetragon.exportAllowList={\"process_exec\",\"process_exit\",\"process_kprobe\"}";
    let output = Command::new("helm")
        .args([
            "upgrade",
            "--install",
            "tetragon",
            "cilium/tetragon",
            "--namespace",
            namespace,
            "--create-namespace",
            "--set",
            values,
        ])
        .output();

    let (helm_ok, helm_output) = match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            let combined = format!("{stdout}{stderr}").trim().to_string();
            (o.status.success(), combined)
        }
        Err(e) => (false, format!("helm exec failed: {e}")),
    };

    if !helm_ok {
        return K8sTetragonInstallResult {
            ok: false,
            helm_output,
            forwarder_applied: false,
            forwarder_output: String::new(),
            message: format!("Helm install failed for cluster {cluster_name}"),
        };
    }

    let forwarder = apply_export_forwarder(cfg, cluster_id, namespace);
    let (forwarder_applied, forwarder_output) = match forwarder {
        Ok(out) => (true, out),
        Err(e) => (false, e),
    };

    let ok = helm_ok;
    let message = if !helm_ok {
        format!("Helm install failed for cluster {cluster_name}: {helm_output}")
    } else if forwarder_applied {
        format!(
            "Tetragon Helm release and PacketWolf export forwarder active in {namespace} for cluster {cluster_name} → {export_url}/k8s-{cluster_id}"
        )
    } else {
        format!(
            "Tetragon Helm release installed in {namespace}; export forwarder pending: {forwarder_output}"
        )
    };

    K8sTetragonInstallResult {
        ok,
        helm_output,
        forwarder_applied,
        forwarder_output,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_includes_cluster_and_export_url() {
        let cfg = ControllerConfig {
            packetwolf_enabled: true,
            packetwolf_base_url: "http://127.0.0.1:9091".into(),
            ..ControllerConfig::default()
        };
        let yaml = render_export_forwarder_manifest(&cfg, "cluster-abc", "kube-system");
        assert!(yaml.contains("packetwolf-export-forwarder"));
        assert!(yaml.contains("k8s-cluster-abc"));
        assert!(yaml.contains("http://127.0.0.1:9091/api/v1/ingest"));
        assert!(yaml.contains("forward.py"));
    }
}
