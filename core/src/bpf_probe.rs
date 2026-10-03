// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Lightweight eBPF visibility via `bpftool` (no custom BPF programs).

use serde::{Deserialize, Serialize};
#[cfg(target_os = "linux")]
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BpfProbeSummary {
    pub available: bool,
    pub bpftool_path: String,
    pub program_count: u32,
    pub map_count: u32,
    pub cgroup_program_count: u32,
    pub tracepoint_count: u32,
    pub notes: Vec<String>,
}

#[cfg(target_os = "linux")]
fn find_bpftool() -> Option<String> {
    for c in ["/usr/sbin/bpftool", "/sbin/bpftool", "/usr/bin/bpftool"] {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    which_bpftool()
}

#[cfg(target_os = "linux")]
fn which_bpftool() -> Option<String> {
    Command::new("which")
        .arg("bpftool")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

#[cfg(target_os = "linux")]
fn count_prog_lines(bpftool: &str, args: &[&str]) -> u32 {
    let out = Command::new(bpftool).args(args).output();
    let Ok(o) = out else {
        return 0;
    };
    if !o.status.success() {
        return 0;
    }
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with("ID"))
        .count() as u32
}

pub fn probe_bpf_summary() -> BpfProbeSummary {
    #[cfg(not(target_os = "linux"))]
    {
        return BpfProbeSummary::default();
    }
    #[cfg(target_os = "linux")]
    {
        let Some(bpftool) = find_bpftool() else {
            return BpfProbeSummary {
                notes: vec!["bpftool not installed".into()],
                ..Default::default()
            };
        };
        let program_count = count_prog_lines(&bpftool, &["prog", "show"]);
        let map_count = count_prog_lines(&bpftool, &["map", "show"]);
        let cgroup_program_count = count_prog_lines(&bpftool, &["prog", "show", "type", "cgroup"]);
        let tracepoint_count = count_prog_lines(&bpftool, &["prog", "show", "type", "tracepoint"]);
        let mut notes = Vec::new();
        if program_count == 0 {
            notes.push("no BPF programs listed (may need CAP_BPF/CAP_SYS_ADMIN)".into());
        }
        BpfProbeSummary {
            available: true,
            bpftool_path: bpftool,
            program_count,
            map_count,
            cgroup_program_count,
            tracepoint_count,
            notes,
        }
    }
}
