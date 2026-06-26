// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use virt::connect::Connect;
use virt::sys;

use super::domain::lookup_domain;
use crate::LibvirtError;

#[cfg(target_os = "linux")]
use super::guest_agent::qemu_agent_command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestUserSession {
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestTimeInfo {
    pub guest_time_rfc3339: String,
    pub host_time_rfc3339: String,
    pub delta_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsFreezeStatus {
    pub frozen: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestFstrimResult {
    pub mountpoint: String,
    pub trimmed_bytes: u64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestAgentActionResult {
    pub action: String,
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<GuestTimeInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs_freeze: Option<FsFreezeStatus>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fstrim: Vec<GuestFstrimResult>,
}

pub fn get_guest_users(vm_name: &str) -> Vec<GuestUserSession> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = vm_name;
        return Vec::new();
    }
    #[cfg(target_os = "linux")]
    {
        let Some(v) = qemu_agent_command(vm_name, r#"{"execute":"guest-get-users"}"#) else {
            return Vec::new();
        };
        let Some(arr) = v.get("return").and_then(|r| r.as_array()) else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|u| {
                let username = u.get("user")?.as_str()?.to_string();
                let login_time = u
                    .get("login-time")
                    .or_else(|| u.get("login_time"))
                    .and_then(|x| x.as_u64())
                    .map(|ts| {
                        DateTime::<Utc>::from_timestamp(ts as i64, 0)
                            .map(|d| d.to_rfc3339())
                            .unwrap_or_else(|| ts.to_string())
                    });
                let host = u
                    .get("domain")
                    .or_else(|| u.get("host"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                Some(GuestUserSession {
                    username,
                    login_time,
                    host,
                })
            })
            .collect()
    }
}

pub fn get_guest_time_info(conn: &Connect, name: &str) -> Result<GuestTimeInfo, LibvirtError> {
    let domain = lookup_domain(conn, name)?;
    if !domain.is_active().unwrap_or(false) {
        return Err(LibvirtError::Invalid("VM must be running".into()));
    }
    let host_now = Utc::now();
    let (guest_secs, guest_nsecs) = domain
        .get_time(0)
        .map_err(|e| LibvirtError::Operation(format!("guest get_time: {e}")))?;
    let guest_dt = DateTime::<Utc>::from_timestamp(guest_secs, guest_nsecs as u32)
        .ok_or_else(|| LibvirtError::Operation("invalid guest time".into()))?;
    let delta_ms = (guest_dt - host_now).num_milliseconds();
    Ok(GuestTimeInfo {
        guest_time_rfc3339: guest_dt.to_rfc3339(),
        host_time_rfc3339: host_now.to_rfc3339(),
        delta_ms,
    })
}

pub fn sync_guest_time_to_host(conn: &Connect, name: &str) -> Result<GuestTimeInfo, LibvirtError> {
    let domain = lookup_domain(conn, name)?;
    if !domain.is_active().unwrap_or(false) {
        return Err(LibvirtError::Invalid("VM must be running".into()));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| LibvirtError::Internal(e.to_string()))?;
    domain
        .set_time(
            now.as_secs() as i64,
            now.subsec_nanos() as i32,
            sys::VIR_DOMAIN_TIME_SYNC,
        )
        .map_err(|e| LibvirtError::Operation(format!("guest set_time: {e}")))?;
    get_guest_time_info(conn, name)
}

pub fn get_fs_freeze_status(vm_name: &str) -> FsFreezeStatus {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = vm_name;
        return FsFreezeStatus {
            frozen: false,
            detail: "unavailable on this platform".into(),
        };
    }
    #[cfg(target_os = "linux")]
    {
        let Some(v) = qemu_agent_command(vm_name, r#"{"execute":"guest-fsfreeze-status"}"#) else {
            return FsFreezeStatus {
                frozen: false,
                detail: "guest-fsfreeze-status unavailable".into(),
            };
        };
        let ret = v.get("return").unwrap_or(&v);
        let frozen = ret.get("frozen").and_then(|x| x.as_bool()).unwrap_or(false);
        let detail = if frozen {
            "One or more guest filesystems are frozen".into()
        } else {
            "No frozen filesystems".into()
        };
        FsFreezeStatus { frozen, detail }
    }
}

pub fn run_guest_fstrim(vm_name: &str) -> Result<Vec<GuestFstrimResult>, LibvirtError> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = vm_name;
        return Ok(Vec::new());
    }
    #[cfg(target_os = "linux")]
    {
        let Some(v) = qemu_agent_command(vm_name, r#"{"execute":"guest-fstrim"}"#) else {
            return Err(LibvirtError::Operation(
                "guest-fstrim failed — is guestkit-agent running?".into(),
            ));
        };
        if let Some(err) = v.get("error") {
            let msg = err
                .get("desc")
                .and_then(|x| x.as_str())
                .unwrap_or("guest-fstrim error");
            return Err(LibvirtError::Operation(msg.to_string()));
        }
        let Some(arr) = v.get("return").and_then(|r| r.as_array()) else {
            return Ok(Vec::new());
        };
        Ok(arr
            .iter()
            .map(|item| {
                let mountpoint = item
                    .get("path")
                    .or_else(|| item.get("mountpoint"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let trimmed_bytes = item
                    .get("minimum")
                    .or_else(|| item.get("trimmed"))
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);
                let error = item
                    .get("error")
                    .and_then(|x| x.as_i64())
                    .filter(|&e| e != 0)
                    .map(|e| format!("error code {e}"))
                    .unwrap_or_default();
                GuestFstrimResult {
                    mountpoint,
                    trimmed_bytes,
                    error,
                }
            })
            .collect())
    }
}

pub fn run_guest_agent_action(
    conn: &Connect,
    name: &str,
    action: &str,
) -> Result<GuestAgentActionResult, LibvirtError> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (conn, name, action);
        return Err(LibvirtError::Invalid(
            "guest agent actions require Linux hypervisor".into(),
        ));
    }
    #[cfg(target_os = "linux")]
    match action.trim().to_ascii_lowercase().as_str() {
        "sync_time" | "sync-time" => {
            let time = sync_guest_time_to_host(conn, name)?;
            Ok(GuestAgentActionResult {
                action: "sync_time".into(),
                ok: true,
                message: format!("Guest time synced (delta was {} ms)", time.delta_ms),
                time: Some(time),
                fs_freeze: None,
                fstrim: Vec::new(),
            })
        }
        "fs_freeze_status" | "fs-freeze-status" => {
            let fs = get_fs_freeze_status(name);
            Ok(GuestAgentActionResult {
                action: "fs_freeze_status".into(),
                ok: true,
                message: fs.detail.clone(),
                time: None,
                fs_freeze: Some(fs),
                fstrim: Vec::new(),
            })
        }
        "fstrim" | "trim" => {
            let fstrim = run_guest_fstrim(name)?;
            let total: u64 = fstrim.iter().map(|r| r.trimmed_bytes).sum();
            Ok(GuestAgentActionResult {
                action: "fstrim".into(),
                ok: true,
                message: format!(
                    "TRIM on {} mount(s), {} bytes reported",
                    fstrim.len(),
                    total
                ),
                time: None,
                fs_freeze: None,
                fstrim,
            })
        }
        other => Err(LibvirtError::Invalid(format!(
            "unknown guest agent action: {other}"
        ))),
    }
}
