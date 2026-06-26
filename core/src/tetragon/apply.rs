// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::install::{render_install_script, run_tetragon_install};
use super::types::{SecurityBundleApplyResult, SecurityFabricStatus, TetragonInstallSpec};
use crate::LibvirtError;

fn policy_dir() -> PathBuf {
    std::env::var("MACHINA_TETRAGON_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/machina/tetragon"))
}

fn policies_subdir() -> PathBuf {
    policy_dir().join("tracing-policies")
}

fn tetragon_tp_dir() -> PathBuf {
    PathBuf::from("/etc/tetragon/tetragon.tp.d")
}

fn sync_policy_to_tetragon(
    name: &str,
    body: Option<&str>,
    dry_run: bool,
) -> Result<(), LibvirtError> {
    if dry_run {
        return Ok(());
    }
    let tp = tetragon_tp_dir();
    let _ = fs::create_dir_all(&tp);
    let dest = tp.join(format!("{name}.json"));
    match body {
        Some(content) => {
            fs::write(&dest, content).map_err(LibvirtError::map_op("write tetragon tp policy"))?
        }
        None => {
            let _ = fs::remove_file(&dest);
        }
    }
    Ok(())
}

fn tetragon_in_path() -> bool {
    PathBuf::from("/usr/local/lib/tetragon/bpf").is_dir()
        && PathBuf::from("/usr/local/bin/tetragon").is_file()
}

fn is_service_active(unit: &str) -> bool {
    std::process::Command::new("systemctl")
        .args(["is-active", "--quiet", unit])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn write_file(path: &Path, contents: &str, dry_run: bool) -> Result<(), LibvirtError> {
    if dry_run {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(LibvirtError::map_op("create tetragon dir"))?;
    }
    fs::write(path, contents).map_err(LibvirtError::map_op("write tetragon file"))
}

pub fn apply_security_bundle(
    bundle_json: &str,
    dry_run: bool,
) -> Result<SecurityBundleApplyResult, LibvirtError> {
    let bundle: Value = serde_json::from_str(bundle_json)
        .map_err(|e| LibvirtError::Invalid(format!("bundle JSON: {e}")))?;
    let dir = policies_subdir();
    let mut operations = Vec::new();
    let mut policies_written = 0usize;

    let policies = bundle
        .get("tracing_policies")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if !dry_run {
        let _ = fs::create_dir_all(&dir);
    }

    let removed = bundle
        .get("removed_policies")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for name in &removed {
        let Some(name_str) = name.as_str() else {
            continue;
        };
        let path = dir.join(format!("{name_str}.json"));
        if path.is_file() && !dry_run {
            fs::remove_file(&path).map_err(LibvirtError::map_op("remove tetragon policy"))?;
            let _ = sync_policy_to_tetragon(name_str, None, dry_run);
        }
        operations.push(format!("remove {}", path.display()));
    }

    for (i, pol) in policies.iter().enumerate() {
        let name = pol
            .pointer("/metadata/name")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("policy-{i}"));
        let path = dir.join(format!("{name}.json"));
        let body = serde_json::to_string_pretty(pol)
            .map_err(|e| LibvirtError::Internal(format!("serialize policy: {e}")))?;
        write_file(&path, &body, dry_run)?;
        sync_policy_to_tetragon(&name, Some(&body), dry_run)?;
        operations.push(format!("write {}", path.display()));
        policies_written += 1;
    }

    let host_id = bundle
        .get("host_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let mut install_script_written = false;
    let mut tetragon_install_attempted = false;
    let mut tetragon_service_active = is_service_active("tetragon.service");
    let mut tetragon_export_timer_active = is_service_active("tetragon-export.timer");
    let mut install_message = String::new();

    if let Some(install) = bundle.get("tetragon_install") {
        if !install.is_null() {
            let export = install
                .get("export_url")
                .and_then(|v| v.as_str())
                .unwrap_or("http://127.0.0.1:9091/api/v1/ingest");
            let spec = TetragonInstallSpec {
                export_url: export.to_string(),
                host_id: host_id.clone(),
            };
            let script = render_install_script(&spec);
            let script_path = policy_dir().join("install-tetragon.sh");
            write_file(&script_path, &script, dry_run)?;
            operations.push(format!("write {}", script_path.display()));
            install_script_written = true;
            tetragon_install_attempted = true;
            match run_tetragon_install(&spec, dry_run) {
                Ok(result) => {
                    operations.extend(result.operations);
                    tetragon_service_active = result.service_active;
                    tetragon_export_timer_active = result.export_timer_active;
                    install_message = if result.ok {
                        result.message
                    } else {
                        format!("Tetragon install failed: {}", result.message)
                    };
                }
                Err(e) => install_message = format!("Tetragon install error: {e}"),
            }
        }
    }

    let manifest_path = policy_dir().join("bundle-manifest.json");
    write_file(&manifest_path, bundle_json, dry_run)?;
    operations.push(format!("write {}", manifest_path.display()));

    let mut reload_message = String::new();
    if !dry_run && (policies_written > 0 || !removed.is_empty()) {
        let reload = std::process::Command::new("systemctl")
            .args(["try-reload-or-restart", "tetragon.service"])
            .output();
        match reload {
            Ok(out) if out.status.success() => {
                operations.push("systemctl try-reload-or-restart tetragon.service".into());
                reload_message = "tetragon reloaded".into();
            }
            Ok(_) => operations.push("systemctl reload skipped (unit missing or failed)".into()),
            Err(_) => operations.push("systemctl reload skipped (systemctl unavailable)".into()),
        }
    }

    let message = if dry_run {
        "Dry run — no files written".into()
    } else if !install_message.is_empty() && !reload_message.is_empty() {
        format!(
            "Applied {policies_written} TracingPolicy file(s); {install_message}; {reload_message}"
        )
    } else if !install_message.is_empty() {
        format!("Applied {policies_written} TracingPolicy file(s); {install_message}")
    } else if !reload_message.is_empty() {
        format!("Applied {policies_written} TracingPolicy file(s); {reload_message}")
    } else {
        format!("Applied {policies_written} TracingPolicy file(s)")
    };

    let install_ok = !tetragon_install_attempted
        || (tetragon_service_active && !install_message.contains("failed"));

    Ok(SecurityBundleApplyResult {
        ok: install_ok,
        policy_dir: dir.display().to_string(),
        policies_written,
        install_script_written,
        tetragon_binary_found: tetragon_in_path(),
        tetragon_install_attempted,
        tetragon_service_active,
        tetragon_export_timer_active,
        operations,
        message,
    })
}

pub fn security_fabric_status() -> Result<SecurityFabricStatus, LibvirtError> {
    let dir = policies_subdir();
    let mut policy_files = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(&dir).map_err(LibvirtError::map_op("read tetragon policies"))? {
            let entry = entry.map_err(LibvirtError::map_op("read policy entry"))?;
            if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
                policy_files.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    policy_files.sort();
    let install_script = policy_dir().join("install-tetragon.sh");
    let export_url = fs::read_to_string(policy_dir().join("bundle-manifest.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| {
            v.pointer("/tetragon_install/export_url")
                .and_then(|u| u.as_str())
                .map(String::from)
        });
    Ok(SecurityFabricStatus {
        policy_dir: dir.display().to_string(),
        policy_files,
        install_script_present: install_script.is_file(),
        tetragon_binary_found: tetragon_in_path(),
        tetragon_service_active: is_service_active("tetragon.service"),
        tetragon_export_timer_active: is_service_active("tetragon-export.timer"),
        export_url,
    })
}
