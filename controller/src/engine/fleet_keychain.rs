// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Fleet Keychain secrets inventory rollup (Phase 44).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::engine::enterprise_security;

#[derive(Debug, Clone, Serialize)]
pub struct FleetKeychainEntry {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FleetKeychainOverview {
    pub summary: String,
    pub vault_providers: usize,
    pub vault_connected: usize,
    pub mfa_policies: usize,
    pub mfa_enrolled_users: usize,
    pub air_gap_bundles: usize,
    pub api_keys: usize,
    pub disconnected_vaults: usize,
    pub entries: Vec<FleetKeychainEntry>,
}

pub async fn overview(pool: &SqlitePool) -> anyhow::Result<FleetKeychainOverview> {
    let sec = enterprise_security::overview(pool).await?;
    let vaults = enterprise_security::list_vault_providers(pool).await?;
    let mfa = enterprise_security::list_mfa_policies(pool).await?;
    let bundles = enterprise_security::list_air_gap_bundles(pool).await?;

    let api_rows: Vec<(Uuid, String, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, name, role, strftime('%Y-%m-%dT%H:%M:%SZ', last_used_at) AS last_used_at FROM api_keys ORDER BY created_at DESC LIMIT 24",
    )
    .fetch_all(pool)
    .await?;

    let disconnected_vaults = vaults.iter().filter(|v| v.status != "active").count();
    let mut entries = Vec::new();

    for v in &vaults {
        entries.push(FleetKeychainEntry {
            kind: "vault".into(),
            id: v.id.to_string(),
            name: v.name.clone(),
            status: v.status.clone(),
            summary: format!(
                "{} · {}{}",
                v.provider_type,
                v.address,
                if v.namespace.is_empty() {
                    String::new()
                } else {
                    format!(" · ns {}", v.namespace)
                }
            ),
        });
    }

    for p in &mfa {
        entries.push(FleetKeychainEntry {
            kind: "mfa".into(),
            id: p.id.to_string(),
            name: p.role_name.clone(),
            status: if p.required { "required" } else { "optional" }.into(),
            summary: format!("{} · {} day grace", p.method, p.grace_days),
        });
    }

    for b in &bundles {
        entries.push(FleetKeychainEntry {
            kind: "air_gap".into(),
            id: b.id.to_string(),
            name: b.name.clone(),
            status: "exported".into(),
            summary: format!(
                "{} · {} KB",
                &b.checksum.chars().take(18).collect::<String>(),
                b.size_bytes / 1024
            ),
        });
    }

    for (id, name, role, last_used) in &api_rows {
        entries.push(FleetKeychainEntry {
            kind: "api_key".into(),
            id: id.to_string(),
            name: name.clone(),
            status: if last_used.is_some() {
                "active"
            } else {
                "unused"
            }
            .into(),
            summary: format!(
                "role {}{}",
                role,
                last_used
                    .map(|t| format!(" · last used {}", t.format("%Y-%m-%d")))
                    .unwrap_or_default()
            ),
        });
    }

    Ok(FleetKeychainOverview {
        summary: format!(
            "{} credential(s) · {} vault connected · {} MFA enrolled · {} API key(s)",
            entries.len(),
            sec.vault_connected,
            sec.mfa_enrolled_users,
            api_rows.len()
        ),
        vault_providers: sec.vault_providers,
        vault_connected: sec.vault_connected,
        mfa_policies: sec.mfa_policies,
        mfa_enrolled_users: sec.mfa_enrolled_users,
        air_gap_bundles: sec.air_gap_bundles,
        api_keys: api_rows.len(),
        disconnected_vaults,
        entries,
    })
}
