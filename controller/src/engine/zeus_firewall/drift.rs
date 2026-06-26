// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use machina_core::FirewallInventory;

#[derive(Debug, Clone, Serialize)]
pub struct DriftReport {
    pub drift_detected: bool,
    pub expected: String,
    pub actual: String,
    pub summary: String,
}

pub fn checksum_inventory(inv: &FirewallInventory) -> String {
    let json = serde_json::to_string(inv).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub async fn save_snapshot(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
    inv: &FirewallInventory,
) -> anyhow::Result<()> {
    let checksum = checksum_inventory(inv);
    sqlx::query(
        "INSERT INTO firewall_posture_snapshots (id, target_kind, target_id, checksum, posture_json) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(target_kind)
    .bind(target_id)
    .bind(&checksum)
    .bind(serde_json::to_value(inv)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn detect_drift(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
    current: &FirewallInventory,
) -> anyhow::Result<DriftReport> {
    let row: Option<(String, serde_json::Value)> = sqlx::query_as(
        "SELECT checksum, posture_json FROM firewall_posture_snapshots
         WHERE target_kind = ? AND target_id = ? ORDER BY captured_at DESC LIMIT 1",
    )
    .bind(target_kind)
    .bind(target_id)
    .fetch_optional(pool)
    .await?;

    let current_sum = checksum_inventory(current);
    let Some((expected_sum, expected_json)) = row else {
        return Ok(DriftReport {
            drift_detected: false,
            expected: "no baseline".into(),
            actual: current_sum,
            summary: "No baseline snapshot yet".into(),
        });
    };

    if expected_sum == current_sum {
        return Ok(DriftReport {
            drift_detected: false,
            expected: expected_sum,
            actual: current_sum,
            summary: "Firewall matches Zeus baseline".into(),
        });
    }

    let expected_rules = expected_json
        .get("rules")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let actual_rules = current.rules.len();
    Ok(DriftReport {
        drift_detected: true,
        expected: format!("{expected_rules} rules (checksum {expected_sum})"),
        actual: format!("{actual_rules} rules (checksum {current_sum})"),
        summary: "Firewall changed outside Zeus OS".into(),
    })
}
