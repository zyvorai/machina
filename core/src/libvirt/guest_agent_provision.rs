// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
//! Default GuestKit in-guest agent (QGA-compatible) for new VMs.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config::LibvirtConfig;
use crate::LibvirtError;

use super::subprocess::VmCreateLogSink;

pub const DEFAULT_CLOUD_INIT_USER: &str = "machina";

const GUESTKIT_UNIT: &str = r#"[Unit]
Description=GuestKit Agent (QGA-compatible virtio channel)
After=network.target
ConditionPathExists=/dev/virtio-ports/org.qemu.guest_agent.0
# Keep retrying rather than giving up after a burst of early-boot failures (e.g. the
# binary install from the seed racing service start).
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/local/bin/guestkit agent --channel virtio
Restart=on-failure
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"#;

/// Effective config when callers only have optional overrides.
pub fn effective_guest_agent_cfg(cfg: Option<&LibvirtConfig>) -> (bool, PathBuf) {
    cfg.map(|c| {
        (
            c.guest_agent_by_default,
            PathBuf::from(&c.guestkit_agent_binary),
        )
    })
    .unwrap_or((true, PathBuf::from("/usr/local/bin/guestkit")))
}

pub fn guest_agent_enabled(cfg: Option<&LibvirtConfig>) -> bool {
    effective_guest_agent_cfg(cfg).0
}

pub fn resolve_guestkit_binary(cfg: Option<&LibvirtConfig>) -> PathBuf {
    let (_, mut path) = effective_guest_agent_cfg(cfg);
    if !path.is_absolute() {
        path = PathBuf::from("/usr/local/bin/guestkit");
    }
    path
}

pub fn vm_wants_graphical_desktop(name: &str) -> bool {
    name.to_ascii_lowercase().contains("desktop")
}

/// Ensure GNOME/GDM autologin on first boot (cloud images default to serial/tty).
pub fn append_desktop_graphical_cloud_config(user_data: &mut String, login_user: &str) {
    if !user_data.ends_with('\n') {
        user_data.push('\n');
    }
    let user = if login_user.trim().is_empty() {
        "ubuntu"
    } else {
        login_user.trim()
    };
    let cmds = [
        format!("  - mkdir -p /etc/gdm3"),
        format!(
            "  - printf '%s\\n' '[daemon]' 'AutomaticLogin={user}' 'AutomaticLoginEnable=true' > /etc/gdm3/custom.conf"
        ),
        "  - [ systemctl, set-default, graphical.target ]".into(),
        "  - bash -lc 'systemctl enable gdm 2>/dev/null || systemctl enable gdm3 2>/dev/null || true'".into(),
        "  - bash -lc 'systemctl restart gdm 2>/dev/null || systemctl restart gdm3 2>/dev/null || true'".into(),
    ];
    if user_data.contains("runcmd:\n") {
        for c in cmds {
            user_data.push_str(&c);
            user_data.push('\n');
        }
    } else {
        user_data.push_str("runcmd:\n");
        for c in cmds {
            user_data.push_str(&c);
            user_data.push('\n');
        }
    }
}

/// Append cloud-config stanzas that install guestkit-agent from the NoCloud seed ISO.
pub fn append_guestkit_cloud_config(user_data: &mut String, binary_on_seed: bool) {
    if !user_data.ends_with('\n') {
        user_data.push('\n');
    }
    user_data.push_str("package_update: false\n");
    user_data.push_str("write_files:\n");
    user_data.push_str("  - path: /etc/systemd/system/guestkit-agent.service\n");
    user_data.push_str("    permissions: '0644'\n");
    user_data.push_str("    content: |\n");
    for line in GUESTKIT_UNIT.lines() {
        user_data.push_str("      ");
        user_data.push_str(line);
        user_data.push('\n');
    }
    if binary_on_seed {
        user_data.push_str("runcmd:\n");
        // Explicitly mount the NoCloud seed by its 'cidata' label and install the
        // guestkit binary from it. cloud-init does NOT leave the seed mounted at a
        // fixed path, so the fallback checks below (/mnt/cidata, /mnt/cdrom, …) miss
        // it — the unit then gets enabled but its ExecStart binary is absent, so the
        // agent never starts. Mounting by label is reliable: the seed ISO is labeled
        // 'cidata'. Do this BEFORE `systemctl enable --now` so the binary exists.
        user_data.push_str("  - mkdir -p /run/guestkit-seed\n");
        user_data.push_str(
            "  - mount -L cidata /run/guestkit-seed 2>/dev/null || mount /dev/sr0 /run/guestkit-seed 2>/dev/null || mount /dev/cdrom /run/guestkit-seed 2>/dev/null || true\n",
        );
        user_data.push_str(
            "  - test -f /run/guestkit-seed/guestkit && install -m755 /run/guestkit-seed/guestkit /usr/local/bin/guestkit || true\n",
        );
        user_data.push_str("  - umount /run/guestkit-seed 2>/dev/null || true\n");
        // Fallbacks for guests where the seed is already mounted somewhere findable.
        user_data.push_str(
            "  - test -x /usr/local/bin/guestkit || (test -f /mnt/cdrom/guestkit && install -m755 /mnt/cdrom/guestkit /usr/local/bin/guestkit) || true\n",
        );
        user_data.push_str(
            "  - test -x /usr/local/bin/guestkit || (test -f /mnt/cidata/guestkit && install -m755 /mnt/cidata/guestkit /usr/local/bin/guestkit) || true\n",
        );
        user_data.push_str(
            "  - test -x /usr/local/bin/guestkit || for m in /run/media/*/guestkit /media/*/guestkit; do [ -f \"$m\" ] && install -m755 \"$m\" /usr/local/bin/guestkit && break; done\n",
        );
    }
    user_data.push_str("  - systemctl daemon-reload\n");
    user_data.push_str("  - systemctl enable --now guestkit-agent\n");
}

/// Copy guestkit binary + optional marker into a seed ISO build directory.
pub fn stage_guestkit_seed_files(
    work_dir: &Path,
    cfg: Option<&LibvirtConfig>,
    log: Option<&VmCreateLogSink>,
) -> Result<(), LibvirtError> {
    if !guest_agent_enabled(cfg) {
        return Ok(());
    }
    let binary = resolve_guestkit_binary(cfg);
    if !binary.is_file() {
        super::subprocess::log_line(
            log,
            "machina",
            &format!(
                "guestkit-agent: binary not found at {} — install guestkit on hypervisor",
                binary.display()
            ),
        );
        return Ok(());
    }
    let dest = work_dir.join("guestkit");
    fs::copy(&binary, &dest).map_err(|e| {
        LibvirtError::Operation(format!(
            "copy guestkit agent to seed dir {}: {e}",
            dest.display()
        ))
    })?;
    fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).map_err(|e| {
        LibvirtError::Operation(format!("chmod guestkit seed {}: {e}", dest.display()))
    })?;
    super::subprocess::log_line(
        log,
        "machina",
        &format!(
            "guestkit-agent staged for cloud-init ({})",
            binary.display()
        ),
    );
    Ok(())
}

/// Inject guestkit agent into a qcow2/raw disk (VM must be off).
pub fn inject_guestkit_into_disk(
    disk_path: &str,
    cfg: Option<&LibvirtConfig>,
    log: Option<&VmCreateLogSink>,
) -> Result<(), LibvirtError> {
    if !guest_agent_enabled(cfg) {
        return Ok(());
    }
    let disk = Path::new(disk_path);
    if !disk.is_file() {
        return Ok(());
    }
    let binary = resolve_guestkit_binary(cfg);
    if !binary.is_file() {
        super::subprocess::log_line(
            log,
            "machina",
            &format!("guestkit inject skipped: {} not found", binary.display()),
        );
        return Ok(());
    }
    let summary = format!(
        "$ guestkit repair {} --inject-agent --agent-binary {}",
        disk.display(),
        binary.display()
    );
    let mut cmd = Command::new("guestkit");
    cmd.args([
        "repair",
        disk.to_string_lossy().as_ref(),
        "--inject-agent",
        "--agent-binary",
        binary.to_string_lossy().as_ref(),
    ]);
    let out = super::subprocess::run_command_streaming(cmd, &summary, "guestkit", log)?;
    if !out.status.success() {
        super::subprocess::log_line(
            log,
            "machina",
            "guestkit inject-agent failed (non-fatal; use cloud-init seed)",
        );
    } else {
        super::subprocess::log_line(log, "machina", "guestkit-agent injected into disk image");
    }
    Ok(())
}
