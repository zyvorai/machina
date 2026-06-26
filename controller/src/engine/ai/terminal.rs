// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct TerminalSuggestion {
    pub label: String,
    pub command: String,
    pub description: String,
    pub scope: String,
}

#[derive(Debug, Serialize)]
pub struct TerminalSuggestResult {
    pub vm_name: String,
    pub observed_state: String,
    pub suggestions: Vec<TerminalSuggestion>,
    pub notes: String,
}

pub async fn suggest(
    pool: &SqlitePool,
    vm_id: Option<Uuid>,
    vm_name_hint: Option<&str>,
) -> anyhow::Result<TerminalSuggestResult> {
    let row: Option<(Uuid, String, String, String)> = if let Some(id) = vm_id {
        sqlx::query_as(
            "SELECT id, name, observed_state, COALESCE(guest_tools_status, 'unknown') FROM vms WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else if let Some(name) = vm_name_hint {
        sqlx::query_as(
            "SELECT id, name, observed_state, COALESCE(guest_tools_status, 'unknown') FROM vms WHERE name LIKE ? LIMIT 1",
        )
        .bind(name)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    let Some((_id, name, state, guest)) = row else {
        return Ok(TerminalSuggestResult {
            vm_name: vm_name_hint.unwrap_or("").into(),
            observed_state: "unknown".into(),
            suggestions: vec![TerminalSuggestion {
                label: "List VMs".into(),
                command: "machina platform vms".into(),
                description: "Find the VM name in platform inventory.".into(),
                scope: "operator".into(),
            }],
            notes: "VM not found in platform inventory — connect control plane or sync hosts."
                .into(),
        });
    };

    let mut suggestions = Vec::new();

    if state == "shutoff" {
        suggestions.push(TerminalSuggestion {
            label: "Start VM".into(),
            command: format!("virsh start {name}"),
            description: "Boot the guest from the hypervisor.".into(),
            scope: "host".into(),
        });
    } else if state == "running" {
        suggestions.push(TerminalSuggestion {
            label: "Guest shell (if configured)".into(),
            command: format!("virsh console {name}"),
            description: "Serial console — exit with Ctrl+]".into(),
            scope: "host".into(),
        });
        suggestions.push(TerminalSuggestion {
            label: "Guest agent ping".into(),
            command: format!(
                "virsh qemu-agent-command {name} '{{\"execute\":\"guest-info\"}}' --pretty"
            ),
            description: "Verify qemu-guest-agent responds.".into(),
            scope: "host".into(),
        });
    }

    if guest == "unknown" || guest == "not_installed" {
        suggestions.push(TerminalSuggestion {
            label: "Install guest tools (Linux)".into(),
            command: "sudo apt-get install -y qemu-guest-agent && sudo systemctl enable --now qemu-guest-agent".into(),
            description: "Run inside the guest as root.".into(),
            scope: "guest".into(),
        });
    } else {
        suggestions.push(TerminalSuggestion {
            label: "Check disk usage".into(),
            command: "df -h && free -m".into(),
            description: "Run inside guest to diagnose full disks or memory pressure.".into(),
            scope: "guest".into(),
        });
        suggestions.push(TerminalSuggestion {
            label: "Top processes".into(),
            command: "top -b -n 1 | head -20".into(),
            description: "Snapshot CPU consumers inside the guest.".into(),
            scope: "guest".into(),
        });
    }

    if let Ok(health) = crate::engine::vm_health::run_vm_health_check(pool, _id).await {
        if health.score_numeric < 70 {
            suggestions.push(TerminalSuggestion {
                label: "Doctor follow-up".into(),
                command: format!("open /platform/vms/{_id}?tab=doctor"),
                description: format!(
                    "Health {}/100 — review Doctor fixes in Platform.",
                    health.score_numeric
                ),
                scope: "operator".into(),
            });
        }
    }

    let notes = if state == "running" {
        "Host commands run on the hypervisor; guest commands via SSH or guest agent.".into()
    } else {
        "Start the VM before guest-side diagnostics.".into()
    };

    Ok(TerminalSuggestResult {
        vm_name: name,
        observed_state: state,
        suggestions,
        notes,
    })
}
