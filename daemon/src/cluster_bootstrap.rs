// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Host cluster bootstrap (k3s → Cilium → metrics-server → KubeVirt/CDI/virtctl).
//! Mirrors the former `scripts/install-k3s-cilium.sh`; invoked from `POST /api/v1/k8s/cluster-bootstrap`.
//!
//! Linux-only; intended for `machina-daemon` running as **root** (stock systemd unit).

use machina_core::LibvirtError;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::{sleep, timeout};
use tracing::{info, warn};

/// Same payload shape as `routes::k8s::KubectlResult` for HTTP responses.
#[derive(Debug, serde::Serialize)]
pub struct BootstrapCmdResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub ok: bool,
}

#[derive(Debug, Clone)]
pub struct ClusterBootstrapParams {
    pub phase: String,
    pub server_ip: Option<String>,
    pub skip_kubevirt_cdi: bool,
    pub install_metrics_server: bool,
}

const K3S_INSTALL_URL: &str = "https://get.k3s.io";
const KUBECONFIG_ADMIN: &str = "/etc/rancher/k3s/k3s.yaml";
const CILIUM_CLI_STABLE: &str =
    "https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt";
const METRICS_SERVER_MANIFEST: &str =
    "https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml";
const KUBEVIRT_STABLE_TXT: &str =
    "https://storage.googleapis.com/kubevirt-prow/release/kubevirt/kubevirt/stable.txt";
const CDI_RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/kubevirt/containerized-data-importer/releases/latest";

const TIMEOUT_K3S_INSTALL_SECS: u64 = 900;
const TIMEOUT_SHELL_LONG_SECS: u64 = 1800;
const TIMEOUT_KUBECTL_SECS: u64 = 600;
/// `kubectl wait … --timeout=10m`
const TIMEOUT_KUBECTL_WAIT_SECS: u64 = 660;
const TIMEOUT_CILIUM_STATUS_SECS: u64 = 900;
const TIMEOUT_METRICS_ROLLOUT_SECS: u64 = 180;

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/root"))
}

fn kubectl_bin() -> PathBuf {
    let p = Path::new("/usr/local/bin/kubectl");
    if p.is_file() {
        p.to_path_buf()
    } else {
        PathBuf::from("kubectl")
    }
}

fn append_section(log: &mut String, title: &str, body: &str) {
    log.push_str("\n=== ");
    log.push_str(title);
    log.push_str(" ===\n");
    log.push_str(body);
    if !body.ends_with('\n') {
        log.push('\n');
    }
}

async fn run_sh(
    label: &str,
    script: &str,
    env: &[(String, String)],
    timeout_secs: u64,
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(script);
    cmd.stdin(Stdio::null());
    for (k, v) in env {
        cmd.env(k, v);
    }
    let cmdline = format!("/bin/sh -c {script:?} (+ {} env vars)", env.len());
    info!(target: "machina_bootstrap", phase = %label, cmdline = %cmdline, "run_sh");

    let child = timeout(
        Duration::from_secs(timeout_secs),
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output(),
    )
    .await
    .map_err(|_| LibvirtError::Operation(format!("{label}: timed out after {timeout_secs}s")))?
    .map_err(|e| LibvirtError::Operation(format!("{label}: spawn failed: {e}")))?;

    let out = String::from_utf8_lossy(&child.stdout).to_string();
    let err = String::from_utf8_lossy(&child.stderr).to_string();
    append_section(stdout_log, label, &out);
    if !err.is_empty() {
        append_section(stderr_log, label, &err);
    }

    if !child.status.success() {
        return Err(LibvirtError::Operation(format!(
            "{label} failed (exit {:?}): {err}",
            child.status.code()
        )));
    }
    Ok(())
}

async fn run_cmd_argv(
    label: &str,
    program: &Path,
    args: &[String],
    env: &[(String, String)],
    timeout_secs: u64,
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    let mut cmd = Command::new(program);
    for a in args {
        cmd.arg(a);
    }
    cmd.stdin(Stdio::null());
    for (k, v) in env {
        cmd.env(k, v);
    }
    let cmdline = format!("{} {}", program.display(), args.join(" "));
    info!(target: "machina_bootstrap", phase = %label, cmd = %cmdline, "run_cmd_argv");

    let child = timeout(
        Duration::from_secs(timeout_secs),
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output(),
    )
    .await
    .map_err(|_| LibvirtError::Operation(format!("{label}: timed out after {timeout_secs}s")))?
    .map_err(|e| LibvirtError::Operation(format!("{label}: spawn failed: {e}")))?;

    let out = String::from_utf8_lossy(&child.stdout).to_string();
    let err = String::from_utf8_lossy(&child.stderr).to_string();
    append_section(stdout_log, label, &out);
    if !err.is_empty() {
        append_section(stderr_log, label, &err);
    }

    if !child.status.success() {
        return Err(LibvirtError::Operation(format!(
            "{label} failed (exit {:?}): {}",
            child.status.code(),
            err.trim()
        )));
    }
    Ok(())
}

/// First IPv4/IPv6 token from `hostname -I` (Linux).
async fn detect_server_ip(stdout_log: &mut String) -> Result<String, LibvirtError> {
    let mut cmd = Command::new("hostname");
    cmd.arg("-I");
    cmd.stdin(Stdio::null());
    let out = timeout(Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| LibvirtError::Operation("hostname -I timed out".into()))?
        .map_err(|e| LibvirtError::Operation(format!("hostname: {e}")))?;
    let line = String::from_utf8_lossy(&out.stdout);
    let ip = line.split_whitespace().next().unwrap_or("127.0.0.1").trim();
    if ip.is_empty() {
        return Err(LibvirtError::Operation(
            "could not determine server IP (hostname -I empty)".into(),
        ));
    }
    append_section(
        stdout_log,
        "detect_server_ip",
        &format!("using first address from hostname -I: {ip}"),
    );
    Ok(ip.to_string())
}

fn kubeconfig_path() -> PathBuf {
    home_dir().join(".kube/config")
}

fn kubeconfig_env_pairs() -> Vec<(String, String)> {
    vec![(
        "KUBECONFIG".into(),
        kubeconfig_path().to_string_lossy().into_owned(),
    )]
}

async fn wait_until_kubectl_nodes(
    kubectl: &Path,
    env: &[(String, String)],
    stdout_log: &mut String,
) -> Result<(), LibvirtError> {
    for attempt in 1..=80 {
        let mut cmd = Command::new(kubectl);
        cmd.args(["get", "nodes"]);
        cmd.stdin(Stdio::null());
        for (k, v) in env {
            cmd.env(k, v);
        }
        match timeout(Duration::from_secs(15), cmd.output()).await {
            Ok(Ok(out)) if out.status.success() => {
                append_section(
                    stdout_log,
                    "kubectl_get_nodes",
                    &String::from_utf8_lossy(&out.stdout),
                );
                return Ok(());
            }
            _ => {}
        }
        sleep(Duration::from_secs(3)).await;
        if attempt % 10 == 0 {
            warn!(target: "machina_bootstrap", attempt, "still waiting for kubectl get nodes");
        }
    }
    Err(LibvirtError::Operation(
        "timed out waiting for Kubernetes API (kubectl get nodes)".into(),
    ))
}

async fn phase_k3s(
    server_ip: &str,
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    let install = format!(
        "curl -sfL {K3S_INSTALL_URL} | sh -s - server --flannel-backend=none --disable-network-policy --disable=traefik"
    );
    let no_env: Vec<(String, String)> = vec![];
    run_sh(
        "k3s_install",
        &install,
        &no_env,
        TIMEOUT_K3S_INSTALL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    let kube_dir = home_dir().join(".kube");
    std::fs::create_dir_all(&kube_dir)
        .map_err(|e| LibvirtError::Operation(format!("mkdir ~/.kube: {e}")))?;

    let cfg = kubeconfig_path();
    std::fs::copy(KUBECONFIG_ADMIN, &cfg)
        .map_err(|e| LibvirtError::Operation(format!("copy k3s admin kubeconfig: {e}")))?;

    let mut yaml = std::fs::read_to_string(&cfg)
        .map_err(|e| LibvirtError::Operation(format!("read kubeconfig: {e}")))?;
    yaml = yaml.replace("127.0.0.1", server_ip);
    std::fs::write(&cfg, yaml)
        .map_err(|e| LibvirtError::Operation(format!("write kubeconfig: {e}")))?;

    append_section(
        stdout_log,
        "kubeconfig",
        &format!(
            "wrote {} (replaced 127.0.0.1 with {server_ip})",
            cfg.display()
        ),
    );

    let k3s_bin = Path::new("/usr/local/bin/k3s");
    let kubectl_link = Path::new("/usr/local/bin/kubectl");
    #[cfg(unix)]
    if !kubectl_link.exists() && k3s_bin.is_file() {
        let _ = std::fs::remove_file(kubectl_link);
        std::os::unix::fs::symlink(k3s_bin, kubectl_link)
            .map_err(|e| LibvirtError::Operation(format!("symlink kubectl -> k3s: {e}")))?;
        append_section(
            stdout_log,
            "kubectl_symlink",
            "/usr/local/bin/kubectl -> k3s",
        );
    }

    Ok(())
}

async fn download_text(client: &reqwest::Client, url: &str) -> Result<String, LibvirtError> {
    let text = client
        .get(url)
        .header(
            "User-Agent",
            "machina-daemon-cluster-bootstrap/1.0 (compatible; +https://github.com/ssahani/machina)",
        )
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| LibvirtError::Operation(format!("GET {url}: {e}")))?
        .error_for_status()
        .map_err(|e| LibvirtError::Operation(format!("GET {url}: {e}")))?
        .text()
        .await
        .map_err(|e| LibvirtError::Operation(format!("read body {url}: {e}")))?;
    Ok(text.trim().to_string())
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<(), LibvirtError> {
    let bytes = client
        .get(url)
        .header("User-Agent", "machina-daemon-cluster-bootstrap/1.0")
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| LibvirtError::Operation(format!("GET {url}: {e}")))?
        .error_for_status()
        .map_err(|e| LibvirtError::Operation(format!("GET {url}: {e}")))?
        .bytes()
        .await
        .map_err(|e| LibvirtError::Operation(format!("read bytes {url}: {e}")))?;
    std::fs::write(dest, bytes)
        .map_err(|e| LibvirtError::Operation(format!("write {}: {e}", dest.display())))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct GithubReleaseTag {
    tag_name: String,
}

fn cilium_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => "amd64",
    }
}

async fn phase_cilium(
    server_ip: &str,
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| LibvirtError::Internal(format!("reqwest client: {e}")))?;

    let ver = download_text(&client, CILIUM_CLI_STABLE).await?;
    let arch = cilium_arch();
    let base =
        format!("https://github.com/cilium/cilium-cli/releases/download/{ver}/cilium-linux-{arch}");
    let tg = format!("{base}.tar.gz");
    let sha_url = format!("{base}.tar.gz.sha256sum");

    let tmp = std::env::temp_dir().join(format!("machina-cilium-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).map_err(|e| LibvirtError::Operation(format!("temp dir: {e}")))?;
    let tg_path = tmp.join(format!("cilium-linux-{arch}.tar.gz"));
    let sha_path = tmp.join(format!("cilium-linux-{arch}.tar.gz.sha256sum"));

    download_file(&client, &tg, &tg_path).await?;
    download_file(&client, &sha_url, &sha_path).await?;

    let sha_check = format!(
        "cd {} && sha256sum --check {}",
        tmp.display(),
        sha_path.file_name().unwrap().to_string_lossy()
    );
    let no_env: Vec<(String, String)> = vec![];
    run_sh(
        "cilium_sha256sum",
        &sha_check,
        &no_env,
        60,
        stdout_log,
        stderr_log,
    )
    .await?;

    let tar_extract = format!("tar xzvfC {} /usr/local/bin", tg_path.display());
    let no_env2: Vec<(String, String)> = vec![];
    run_sh(
        "cilium_tar",
        &tar_extract,
        &no_env2,
        120,
        stdout_log,
        stderr_log,
    )
    .await?;

    let _ = std::fs::remove_dir_all(&tmp);

    let kube_env = kubeconfig_env_pairs();
    let kubectl = kubectl_bin();
    wait_until_kubectl_nodes(&kubectl, &kube_env, stdout_log).await?;

    run_cmd_argv(
        "cilium_install",
        Path::new("cilium"),
        &[
            "install".into(),
            "--set".into(),
            "kubeProxyReplacement=false".into(),
            "--set".into(),
            format!("k8sServiceHost={server_ip}"),
            "--set".into(),
            "k8sServicePort=6443".into(),
        ],
        &kube_env,
        TIMEOUT_SHELL_LONG_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "cilium_status_wait",
        Path::new("cilium"),
        &["status".into(), "--wait".into()],
        &kube_env,
        TIMEOUT_CILIUM_STATUS_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "cilium_upgrade",
        Path::new("cilium"),
        &[
            "upgrade".into(),
            "--set".into(),
            "kubeProxyReplacement=false".into(),
            "--set".into(),
            format!("k8sServiceHost={server_ip}"),
            "--set".into(),
            "k8sServicePort=6443".into(),
            "--set".into(),
            "hubble.enabled=true".into(),
            "--set".into(),
            "hubble.relay.enabled=true".into(),
            "--set".into(),
            "hubble.ui.enabled=true".into(),
        ],
        &kube_env,
        TIMEOUT_SHELL_LONG_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "cilium_status_wait_2",
        Path::new("cilium"),
        &["status".into(), "--wait".into()],
        &kube_env,
        TIMEOUT_CILIUM_STATUS_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "kubectl_get_nodes_wide",
        &kubectl,
        &["get".into(), "nodes".into(), "-o".into(), "wide".into()],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;
    run_cmd_argv(
        "kubectl_get_pods_A",
        &kubectl,
        &["get".into(), "pods".into(), "-A".into()],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    let mut sh_cmd = Command::new("/bin/sh");
    sh_cmd
        .arg("-c")
        .arg("kubectl get svc -n kube-system 2>/dev/null | grep hubble || true");
    sh_cmd.stdin(Stdio::null());
    for (k, v) in &kube_env {
        sh_cmd.env(k, v);
    }
    if let Ok(out) = sh_cmd.output().await {
        append_section(
            stdout_log,
            "hubble_svc_grep",
            &String::from_utf8_lossy(&out.stdout),
        );
    }

    Ok(())
}

async fn phase_metrics(
    install: bool,
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    if !install {
        append_section(
            stdout_log,
            "metrics_server",
            "skipped (install_metrics_server=false)",
        );
        return Ok(());
    }

    let kube_env = kubeconfig_env_pairs();
    let kubectl = kubectl_bin();

    let mut check = Command::new(&kubectl);
    check.args(["get", "deployment", "metrics-server", "-n", "kube-system"]);
    check.stdin(Stdio::null());
    for (k, v) in &kube_env {
        check.env(k, v);
    }
    let exists = check
        .output()
        .await
        .ok()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if exists {
        append_section(stdout_log, "metrics_server", "already present");
        return Ok(());
    }

    run_cmd_argv(
        "kubectl_apply_metrics_server",
        &kubectl,
        &["apply".into(), "-f".into(), METRICS_SERVER_MANIFEST.into()],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    let patch = r#"[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]"#;
    let mut p = Command::new(&kubectl);
    p.args([
        "patch",
        "deployment",
        "metrics-server",
        "-n",
        "kube-system",
        "--type=json",
        "-p",
        patch,
    ]);
    p.stdin(Stdio::null());
    for (k, v) in &kube_env {
        p.env(k, v);
    }
    let _ = p.output().await;

    let mut roll = Command::new(&kubectl);
    roll.args([
        "rollout",
        "status",
        "deployment/metrics-server",
        "-n",
        "kube-system",
        &format!("--timeout={TIMEOUT_METRICS_ROLLOUT_SECS}s"),
    ]);
    roll.stdin(Stdio::null());
    for (k, v) in &kube_env {
        roll.env(k, v);
    }
    match roll.output().await {
        Ok(o) => append_section(
            stdout_log,
            "metrics_server_rollout",
            &String::from_utf8_lossy(&o.stdout),
        ),
        Err(_) => append_section(
            stderr_log,
            "metrics_server_rollout",
            "rollout status failed or timed out — check kube-system",
        ),
    }

    Ok(())
}

async fn phase_kubevirt_cdi(
    stdout_log: &mut String,
    stderr_log: &mut String,
) -> Result<(), LibvirtError> {
    let kube_env = kubeconfig_env_pairs();
    let kubectl = kubectl_bin();

    let mut vhv = Command::new("virt-host-validate");
    vhv.arg("qemu");
    vhv.stdin(Stdio::null());
    if let Ok(o) = vhv.output().await {
        append_section(
            stdout_log,
            "virt_host_validate",
            &String::from_utf8_lossy(&o.stdout),
        );
        if !o.stderr.is_empty() {
            append_section(
                stderr_log,
                "virt_host_validate",
                &String::from_utf8_lossy(&o.stderr),
            );
        }
    } else {
        append_section(
            stdout_log,
            "virt_host_validate",
            "virt-host-validate not available — skipping host check",
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| LibvirtError::Internal(format!("reqwest: {e}")))?;

    let kv_ver = download_text(&client, KUBEVIRT_STABLE_TXT).await?;
    if kv_ver.is_empty() {
        return Err(LibvirtError::Operation(
            "empty KubeVirt stable.txt response".into(),
        ));
    }

    let op_url = format!(
        "https://github.com/kubevirt/kubevirt/releases/download/{kv_ver}/kubevirt-operator.yaml"
    );
    let cr_url =
        format!("https://github.com/kubevirt/kubevirt/releases/download/{kv_ver}/kubevirt-cr.yaml");

    run_cmd_argv(
        "kubectl_kubevirt_operator",
        &kubectl,
        &["apply".into(), "-f".into(), op_url],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;
    run_cmd_argv(
        "kubectl_kubevirt_cr",
        &kubectl,
        &["apply".into(), "-f".into(), cr_url],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "kubectl_wait_kubevirt",
        &kubectl,
        &[
            "-n".into(),
            "kubevirt".into(),
            "wait".into(),
            "kv/kubevirt".into(),
            "--for=condition=Available".into(),
            "--timeout=10m".into(),
        ],
        &kube_env,
        TIMEOUT_KUBECTL_WAIT_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    let body = client
        .get(CDI_RELEASES_LATEST_API)
        .header("User-Agent", "machina-daemon-cluster-bootstrap/1.0")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| LibvirtError::Operation(format!("GitHub CDI API: {e}")))?
        .error_for_status()
        .map_err(|e| LibvirtError::Operation(format!("GitHub CDI API: {e}")))?
        .json::<GithubReleaseTag>()
        .await
        .map_err(|e| LibvirtError::Operation(format!("parse GitHub CDI JSON: {e}")))?;

    let cdi_ver = body.tag_name.trim();
    if cdi_ver.is_empty() {
        return Err(LibvirtError::Operation("empty CDI tag_name".into()));
    }

    let cdi_op = format!(
        "https://github.com/kubevirt/containerized-data-importer/releases/download/{cdi_ver}/cdi-operator.yaml"
    );
    let cdi_cr = format!(
        "https://github.com/kubevirt/containerized-data-importer/releases/download/{cdi_ver}/cdi-cr.yaml"
    );

    run_cmd_argv(
        "kubectl_cdi_operator",
        &kubectl,
        &["apply".into(), "-f".into(), cdi_op],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;
    run_cmd_argv(
        "kubectl_cdi_cr",
        &kubectl,
        &["apply".into(), "-f".into(), cdi_cr],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    let wait_ns = run_cmd_argv(
        "kubectl_wait_cdi_ns",
        &kubectl,
        &[
            "-n".into(),
            "cdi".into(),
            "wait".into(),
            "cdi".into(),
            "cdi".into(),
            "--for=condition=Available".into(),
            "--timeout=10m".into(),
        ],
        &kube_env,
        TIMEOUT_KUBECTL_WAIT_SECS,
        stdout_log,
        stderr_log,
    )
    .await;

    if wait_ns.is_err() {
        run_cmd_argv(
            "kubectl_wait_cdi_cluster",
            &kubectl,
            &[
                "wait".into(),
                "cdi/cdi".into(),
                "--for=condition=Available".into(),
                "--timeout=10m".into(),
            ],
            &kube_env,
            TIMEOUT_KUBECTL_WAIT_SECS,
            stdout_log,
            stderr_log,
        )
        .await?;
    }

    let arch = cilium_arch();
    let virt_url = format!(
        "https://github.com/kubevirt/kubevirt/releases/download/{kv_ver}/virtctl-{kv_ver}-linux-{arch}"
    );
    let tmp_virt = std::env::temp_dir().join(format!("virtctl-{}", uuid::Uuid::new_v4()));
    download_file(&client, &virt_url, &tmp_virt).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp_virt)
            .map_err(|e| LibvirtError::Operation(format!("virtctl stat: {e}")))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp_virt, perms)
            .map_err(|e| LibvirtError::Operation(format!("chmod virtctl: {e}")))?;
    }

    let dest = Path::new("/usr/local/bin/virtctl");
    let _ = std::fs::remove_file(dest);
    std::fs::rename(&tmp_virt, dest)
        .map_err(|e| LibvirtError::Operation(format!("install virtctl: {e}")))?;

    run_cmd_argv(
        "kubectl_get_kubevirt_ns",
        &kubectl,
        &["get".into(), "pods".into(), "-n".into(), "kubevirt".into()],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;
    run_cmd_argv(
        "kubectl_get_cdi_ns",
        &kubectl,
        &["get".into(), "pods".into(), "-n".into(), "cdi".into()],
        &kube_env,
        TIMEOUT_KUBECTL_SECS,
        stdout_log,
        stderr_log,
    )
    .await?;

    run_cmd_argv(
        "virtctl_version",
        Path::new("virtctl"),
        &["version".into()],
        &kube_env,
        60,
        stdout_log,
        stderr_log,
    )
    .await?;

    Ok(())
}

fn print_footer(skip_kv: bool, stdout_log: &mut String) {
    let mut msg = String::from("\n[SUCCESS] k3s + Cilium + Hubble UI");
    if !skip_kv {
        msg.push_str(" + KubeVirt + CDI");
    }
    msg.push_str("\n\nOpen Hubble UI:\n  cilium hubble ui\n\nOr:\n  kubectl -n kube-system port-forward svc/hubble-ui 12000:80\n  http://localhost:12000\n");
    if !skip_kv {
        msg.push_str("\nKubeVirt / CDI:\n  kubectl get kubevirt -n kubevirt\n  kubectl get cdi\n  kubectl get storageclass\n  virtctl version\n\nConfigure [kubevirt] in machina config.toml for YAML bundles.\n");
    }
    stdout_log.push_str(&msg);
}

pub async fn run_cluster_bootstrap(
    params: ClusterBootstrapParams,
) -> Result<BootstrapCmdResult, LibvirtError> {
    let phase = params.phase.trim().to_string();
    let summary = format!(
        "cluster_bootstrap Rust phase={phase} server_ip={:?} skip_kubevirt_cdi={} install_metrics_server={}",
        params.server_ip.as_deref(),
        params.skip_kubevirt_cdi,
        params.install_metrics_server
    );
    info!(target: "machina_bootstrap", summary = %summary, "start");

    let mut stdout_log = String::new();
    let mut stderr_log = String::new();

    let server_ip = if let Some(ref ip) = params.server_ip {
        ip.trim().to_string()
    } else {
        detect_server_ip(&mut stdout_log).await?
    };

    let result = async {
        match phase.as_str() {
            "full" => {
                phase_k3s(&server_ip, &mut stdout_log, &mut stderr_log).await?;
                phase_cilium(&server_ip, &mut stdout_log, &mut stderr_log).await?;
                phase_metrics(
                    params.install_metrics_server,
                    &mut stdout_log,
                    &mut stderr_log,
                )
                .await?;
                if params.skip_kubevirt_cdi {
                    append_section(
                        &mut stdout_log,
                        "kubevirt_cdi",
                        "skipped (skip_kubevirt_cdi=true)",
                    );
                } else {
                    phase_kubevirt_cdi(&mut stdout_log, &mut stderr_log).await?;
                }
                print_footer(params.skip_kubevirt_cdi, &mut stdout_log);
                Ok(())
            }
            "k3s" => phase_k3s(&server_ip, &mut stdout_log, &mut stderr_log).await,
            "cilium" => phase_cilium(&server_ip, &mut stdout_log, &mut stderr_log).await,
            "metrics" => {
                phase_metrics(
                    params.install_metrics_server,
                    &mut stdout_log,
                    &mut stderr_log,
                )
                .await
            }
            "kubevirt_cdi" => phase_kubevirt_cdi(&mut stdout_log, &mut stderr_log).await,
            _ => Err(LibvirtError::Invalid(format!(
                "unknown phase {phase} (expected full|k3s|cilium|metrics|kubevirt_cdi)"
            ))),
        }
    }
    .await;

    match result {
        Ok(()) => Ok(BootstrapCmdResult {
            command: summary,
            stdout: stdout_log,
            stderr: stderr_log,
            exit_code: 0,
            ok: true,
        }),
        Err(e) => {
            let msg = format!("{e}");
            Err(LibvirtError::Operation(format!(
                "{msg}\n\n--- stdout ---\n{stdout_log}\n--- stderr ---\n{stderr_log}"
            )))
        }
    }
}
