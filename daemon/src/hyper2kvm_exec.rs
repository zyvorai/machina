// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Optional hyper2kvm / h2kvmctl subprocess for convert + guest fix + OpenStack deploy.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use machina_core::openstack::GlanceUploadRequest;
use machina_core::LibvirtError;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Hyper2kvmPushResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub config_path: String,
}

fn running_as_root() -> bool {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "0")
        .unwrap_or(false)
}

pub fn find_h2kvmctl() -> Option<PathBuf> {
    for name in ["h2kvmctl", "hyper2kvm"] {
        if let Ok(o) = std::process::Command::new("command")
            .args(["-v", name])
            .output()
        {
            if o.status.success() {
                let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(PathBuf::from(p));
                }
            }
        }
    }
    for c in [
        "/usr/local/bin/h2kvmctl",
        "/usr/bin/h2kvmctl",
        "/usr/local/bin/hyper2kvm",
    ] {
        let p = Path::new(c);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }
    None
}

fn yaml_escape(s: &str) -> String {
    if s.contains([':', '#', '\n', '"']) {
        format!("{:?}", s)
    } else {
        s.to_string()
    }
}

/// Build h2kvmctl YAML: local convert/fix on disk path, optional deploy_openstack.
pub fn write_hyper2kvm_openstack_config(
    disk_path: &str,
    output_dir: &Path,
    glance_name: &str,
    upload: &GlanceUploadRequest,
    guest_fix: bool,
) -> Result<(PathBuf, String), LibvirtError> {
    let out_dir = output_dir.to_string_lossy();
    let mut yaml = format!(
        "cmd: local\nvmdk: {}\noutput_dir: {}\nflatten: true\nto_output: migrated.qcow2\n",
        yaml_escape(disk_path),
        yaml_escape(&out_dir),
    );
    if guest_fix {
        yaml.push_str(
            "regen_initramfs: true\nupdate_grub: true\nfstab_mode: stabilize-all\nremove_vmware_tools: true\n",
        );
    } else {
        yaml.push_str("fstab_mode: noop\n");
    }
    yaml.push_str("deploy_openstack: true\n");
    yaml.push_str(&format!("glance_name: {}\n", yaml_escape(glance_name)));
    if let Some(ref v) = upload.visibility {
        if !v.is_empty() {
            yaml.push_str(&format!("openstack_visibility: {}\n", yaml_escape(v)));
        }
    }
    if upload.boot_instance == Some(true) {
        yaml.push_str("openstack_boot_instance: true\n");
        if let Some(ref f) = upload.flavor {
            if !f.is_empty() {
                yaml.push_str(&format!("openstack_flavor: {}\n", yaml_escape(f)));
            }
        }
        if let Some(ref n) = upload.network {
            if !n.is_empty() {
                yaml.push_str(&format!("openstack_network: {}\n", yaml_escape(n)));
            }
        }
        if let Some(ref k) = upload.key_name {
            if !k.is_empty() {
                yaml.push_str(&format!("openstack_key_name: {}\n", yaml_escape(k)));
            }
        }
        if let Some(ref n) = upload.instance_name {
            if !n.is_empty() {
                yaml.push_str(&format!("openstack_server_name: {}\n", yaml_escape(n)));
            }
        }
        if let Some(sg) = upload
            .security_groups
            .as_ref()
            .and_then(|v| v.first())
            .filter(|s| !s.is_empty())
        {
            yaml.push_str(&format!("openstack_security_group: {}\n", yaml_escape(sg)));
        }
        if let Some(ref az) = upload.availability_zone {
            if !az.is_empty() {
                yaml.push_str(&format!(
                    "openstack_availability_zone: {}\n",
                    yaml_escape(az)
                ));
            }
        }
        if upload.wait_until_active == Some(true) {
            yaml.push_str("openstack_wait: true\n");
        }
    }
    let cfg_path = output_dir.join("machina-h2kvm-openstack.yaml");
    std::fs::write(&cfg_path, &yaml)
        .map_err(|e| LibvirtError::Operation(format!("write hyper2kvm config: {e}")))?;
    Ok((cfg_path, yaml))
}

/// Run h2kvmctl with generated config (requires hyper2kvm[openstack] on PATH).
pub async fn run_hyper2kvm_openstack_push(
    disk_path: &str,
    glance_name: &str,
    upload: &GlanceUploadRequest,
    guest_fix: bool,
) -> Result<Hyper2kvmPushResult, LibvirtError> {
    let bin = find_h2kvmctl().ok_or_else(|| {
        LibvirtError::Invalid(
            "h2kvmctl not found on PATH; install hyper2kvm or use native Glance upload".into(),
        )
    })?;
    let work = std::env::temp_dir().join(format!("machina-h2kvm-{}", std::process::id()));
    std::fs::create_dir_all(&work)
        .map_err(|e| LibvirtError::Operation(format!("mkdir work: {e}")))?;
    let (cfg_path, _yaml) =
        write_hyper2kvm_openstack_config(disk_path, &work, glance_name, upload, guest_fix)?;

    let mut cmd = if std::env::var_os("MACHINA_H2KVM_NO_SUDO").is_some() || running_as_root() {
        Command::new(&bin)
    } else {
        let mut c = Command::new("sudo");
        c.arg(&bin);
        c
    };
    cmd.arg("--config")
        .arg(&cfg_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| LibvirtError::Operation(format!("spawn h2kvmctl: {e}")))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut out_lines = Vec::new();
    let mut err_lines = Vec::new();

    if let Some(stdout) = stdout {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            out_lines.push(line);
        }
    }
    if let Some(stderr) = stderr {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            err_lines.push(line);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| LibvirtError::Operation(format!("wait h2kvmctl: {e}")))?;
    let code = status.code().unwrap_or(-1);
    let _ = std::fs::remove_dir_all(&work);

    Ok(Hyper2kvmPushResult {
        exit_code: code,
        stdout: out_lines.join("\n"),
        stderr: err_lines.join("\n"),
        config_path: cfg_path.to_string_lossy().into_owned(),
    })
}
