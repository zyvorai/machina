// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Execute allow-listed host commands as an OIDC-mapped local user (`sudo` or `pkexec`).

use std::path::Path;
use std::process::{Command, Output, Stdio};

use crate::config::RunAsUserConfig;
use crate::system_accounts;
use crate::LibvirtError;

/// Basenames permitted when impersonation is active.
const ALLOWED_PROGRAMS: &[&str] = &[
    "useradd", "userdel", "usermod", "homectl", "chpasswd", "id", "getent",
];

fn program_allowed(program: &str) -> bool {
    let base = Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program);
    ALLOWED_PROGRAMS.contains(&base)
}

fn wrap_command(
    cfg: &RunAsUserConfig,
    unix_user: &str,
    program: &str,
    args: &[&str],
) -> Result<Command, LibvirtError> {
    if !system_accounts::unix_user_exists(unix_user) {
        return Err(LibvirtError::Forbidden(format!(
            "Mapped UNIX user '{unix_user}' does not exist on this host"
        )));
    }
    if !program_allowed(program) {
        return Err(LibvirtError::Forbidden(format!(
            "Program '{program}' is not allowed for run-as-user execution"
        )));
    }
    if cfg.setuid_helper_impersonation_active() {
        let mut c = Command::new(&cfg.setuid_helper_path);
        c.arg(unix_user).arg(program);
        c.args(args);
        return Ok(c);
    }
    if cfg.polkit_impersonation_active() {
        let mut c = Command::new("pkexec");
        c.arg("--user").arg(unix_user).arg("--").arg(program);
        c.args(args);
        return Ok(c);
    }
    if cfg.sudo_impersonation_active() {
        let mut c = Command::new("sudo");
        c.arg("-n").arg("-u").arg(unix_user).arg("--").arg(program);
        c.args(args);
        return Ok(c);
    }
    let mut c = Command::new(program);
    c.args(args);
    Ok(c)
}

/// Build command for impersonation backends when configured.
pub fn command_as_user(
    cfg: &RunAsUserConfig,
    unix_user: &str,
    program: &str,
    args: &[&str],
) -> Result<Command, LibvirtError> {
    if cfg.impersonation_active() {
        return wrap_command(cfg, unix_user, program, args);
    }
    let mut c = Command::new(program);
    c.args(args);
    Ok(c)
}

pub fn status_as_user(
    cfg: &RunAsUserConfig,
    unix_user: Option<&str>,
    program: &str,
    args: &[&str],
) -> Result<std::process::ExitStatus, LibvirtError> {
    let mut cmd = match unix_user {
        Some(u) if cfg.impersonation_active() => command_as_user(cfg, u, program, args)?,
        Some(_) | None => {
            let mut c = Command::new(program);
            c.args(args);
            c
        }
    };
    cmd.status()
        .map_err(|e| LibvirtError::Operation(format!("{program}: {e}")))
}

pub fn output_as_user(
    cfg: &RunAsUserConfig,
    unix_user: Option<&str>,
    program: &str,
    args: &[&str],
) -> Result<Output, LibvirtError> {
    let mut cmd = match unix_user {
        Some(u) if cfg.impersonation_active() => command_as_user(cfg, u, program, args)?,
        Some(_) | None => {
            let mut c = Command::new(program);
            c.args(args);
            c
        }
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.output()
        .map_err(|e| LibvirtError::Operation(format!("{program}: {e}")))
}
