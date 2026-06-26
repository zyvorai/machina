// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use machina_core::{
    compile_metal_plan, gather_metal_inventory, scan_ipmi_exposure, FirewallPlanRequest,
    FirewallPlanResult, MetalServerInput,
};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BaremetalFirewallRow {
    pub id: Uuid,
    pub hostname: String,
    pub bmc_address: String,
    pub bmc_type: String,
    pub state: String,
    pub firewall_profile: String,
    pub firewall_enabled: bool,
    pub bmc_vlan: String,
    pub pxe_vlan: String,
    pub posture_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BaremetalFirewallOverview {
    pub servers: Vec<BaremetalTargetSummary>,
    pub critical_count: usize,
    pub warning_count: usize,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BaremetalTargetSummary {
    pub id: String,
    pub hostname: String,
    pub bmc_address: String,
    pub firewall_profile: String,
    pub risk: String,
    pub score: u32,
    pub open_ports: usize,
}

pub fn row_to_input(row: &BaremetalFirewallRow) -> MetalServerInput {
    MetalServerInput {
        hostname: row.hostname.clone(),
        bmc_address: row.bmc_address.clone(),
        bmc_type: row.bmc_type.clone(),
        firewall_profile: row.firewall_profile.clone(),
        firewall_enabled: row.firewall_enabled,
        bmc_vlan: row.bmc_vlan.clone(),
        pxe_vlan: row.pxe_vlan.clone(),
    }
}

pub async fn load_row(pool: &SqlitePool, id: Uuid) -> anyhow::Result<BaremetalFirewallRow> {
    sqlx::query_as(
        "SELECT id, hostname, bmc_address, bmc_type, state, firewall_profile, firewall_enabled,
                bmc_vlan, pxe_vlan, posture_json
         FROM baremetal_servers WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("bare metal server not found"))
}

pub async fn load_all(pool: &SqlitePool) -> anyhow::Result<Vec<BaremetalFirewallRow>> {
    Ok(sqlx::query_as(
        "SELECT id, hostname, bmc_address, bmc_type, state, firewall_profile, firewall_enabled,
                bmc_vlan, pxe_vlan, posture_json
         FROM baremetal_servers ORDER BY hostname",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn metal_overview(pool: &SqlitePool) -> anyhow::Result<BaremetalFirewallOverview> {
    let rows = load_all(pool).await?;
    let mut critical = 0usize;
    let mut warning = 0usize;
    let servers: Vec<BaremetalTargetSummary> = rows
        .iter()
        .map(|row| {
            let inv = gather_metal_inventory(&row_to_input(row));
            let risk = super::inventory::risk_label(&inv).to_string();
            if risk == "critical" {
                critical += 1;
            } else if risk == "warning" {
                warning += 1;
            }
            BaremetalTargetSummary {
                id: row.id.to_string(),
                hostname: row.hostname.clone(),
                bmc_address: row.bmc_address.clone(),
                firewall_profile: row.firewall_profile.clone(),
                risk,
                score: inv.score.score,
                open_ports: inv.open_ports.len(),
            }
        })
        .collect();
    Ok(BaremetalFirewallOverview {
        summary: format!(
            "{} bare-metal servers · {} critical · {} warnings",
            servers.len(),
            critical,
            warning
        ),
        servers,
        critical_count: critical,
        warning_count: warning,
    })
}

pub async fn scan_exposure(
    pool: &SqlitePool,
    id: Uuid,
    actor: &str,
) -> anyhow::Result<serde_json::Value> {
    let row = load_row(pool, id).await?;
    let scan = scan_ipmi_exposure(&row.bmc_address, &row.bmc_type);
    let posture = serde_json::to_value(&scan)?;
    sqlx::query(
        "UPDATE baremetal_servers SET posture_json = ?, last_exposure_scan_at = datetime('now') WHERE id = ?",
    )
    .bind(&posture)
    .bind(id)
    .execute(pool)
    .await?;

    let inv = gather_metal_inventory(&row_to_input(&row));
    let _ = super::drift::save_snapshot(pool, "bare_metal", id, &inv).await;

    let _ = sqlx::query(
        "INSERT INTO firewall_timeline (id, target_kind, target_id, kind, summary, detail_json, actor) VALUES (?, 'bare_metal', ?, 'metal_scan', ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(id)
    .bind(format!("Exposure scan — risk {}", scan.risk))
    .bind(&posture)
    .bind(actor)
    .execute(pool)
    .await;

    Ok(posture)
}

pub async fn plan_metal(
    pool: &SqlitePool,
    id: Uuid,
    req: FirewallPlanRequest,
) -> anyhow::Result<FirewallPlanResult> {
    let row = load_row(pool, id).await?;
    compile_metal_plan(&row_to_input(&row), &req).map_err(|e| anyhow::anyhow!(e.to_string()))
}

pub async fn apply_metal(
    pool: &SqlitePool,
    id: Uuid,
    req: FirewallPlanRequest,
    actor: &str,
) -> anyhow::Result<FirewallPlanResult> {
    let row = load_row(pool, id).await?;
    let mut apply_req = req;
    apply_req.dry_run = false;

    let inv = gather_metal_inventory(&row_to_input(&row));
    let _ =
        super::checkpoint::save_checkpoint(pool, "bare_metal", id, "pre-apply", &inv, Some(actor))
            .await;

    let result = compile_metal_plan(&row_to_input(&row), &apply_req)?;

    let profile = apply_req
        .profile
        .clone()
        .unwrap_or_else(|| row.firewall_profile.clone());
    let enabled = apply_req.enable.unwrap_or(true);

    sqlx::query(
        "UPDATE baremetal_servers SET firewall_profile = ?, firewall_enabled = ? WHERE id = ?",
    )
    .bind(&profile)
    .bind(enabled)
    .bind(id)
    .execute(pool)
    .await?;

    let after = gather_metal_inventory(&MetalServerInput {
        firewall_profile: profile.clone(),
        firewall_enabled: enabled,
        ..row_to_input(&row)
    });
    let _ = super::drift::save_snapshot(pool, "bare_metal", id, &after).await;

    let kind = if profile == "MetalLockdown" {
        "metal_lockdown"
    } else {
        "metal_profile_applied"
    };
    let _ = sqlx::query(
        "INSERT INTO firewall_timeline (id, target_kind, target_id, kind, summary, detail_json, actor) VALUES (?, 'bare_metal', ?, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(id)
    .bind(kind)
    .bind(format!("Applied metal profile {profile} (policy-only)"))
    .bind(serde_json::json!({ "operations": result.operations, "tag": "metal" }))
    .bind(actor)
    .execute(pool)
    .await;

    Ok(result)
}

pub async fn upsert_gitops_policy(
    pool: &SqlitePool,
    hostname: &str,
    profile: &str,
) -> anyhow::Result<()> {
    let name = format!("metal-{hostname}");
    let spec_yaml = format!(
        "apiVersion: zeus.machina/v1\nkind: MachineFirewallPolicy\nmetadata:\n  name: {name}\nspec:\n  targetKind: bare_metal\n  profile: {profile}\n  scope: bmc+pxe\n"
    );
    sqlx::query(
        "INSERT INTO firewall_policies (id, name, spec_yaml) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET spec_yaml = EXCLUDED.spec_yaml, updated_at = datetime('now')",
    )
    .bind(Uuid::new_v4())
    .bind(&name)
    .bind(&spec_yaml)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct MetalTemporaryPreset {
    pub preset: String,
    pub reason: String,
    #[serde(default)]
    pub owner: Option<String>,
}

pub async fn create_metal_temporary_preset(
    pool: &SqlitePool,
    id: Uuid,
    preset: &str,
    reason: &str,
    owner: Option<&str>,
) -> anyhow::Result<super::TemporaryRule> {
    let (port, _port2, proto, hours) = match preset {
        "pxe" => {
            let (a, b, p, h) = machina_core::metal_preset_temporary_pxe();
            (a, b, p, h)
        }
        "bmc" | _ => {
            let (a, b, p, h) = machina_core::metal_preset_temporary_bmc();
            (a, b, p, h)
        }
    };
    super::temporary::create_temporary_rule(
        pool,
        super::TemporaryRuleRequest {
            target_kind: "bare_metal".into(),
            target_id: id,
            source_cidr: "10.0.0.0/8".into(),
            dest_port: port,
            protocol: proto,
            reason: reason.into(),
            duration_hours: hours,
            owner: owner.map(String::from),
        },
    )
    .await
}
