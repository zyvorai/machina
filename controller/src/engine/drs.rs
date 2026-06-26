// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent_client;
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(120));
        loop {
            interval.tick().await;
            if !state.leader.is_leader() {
                continue;
            }
            if let Err(e) = run_auto_migrate(&state).await {
                tracing::warn!("DRS auto-migrate: {e:#}");
            }
        }
    });
}

async fn run_auto_migrate(state: &AppState) -> anyhow::Result<()> {
    let Some(enabled): Option<bool> =
        sqlx::query_scalar("SELECT drs_auto_migrate FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_optional(&state.pool)
            .await?
    else {
        return Ok(());
    };

    if !enabled {
        return Ok(());
    }

    let recs = crate::engine::placement::compute_recommendations(&state.pool).await?;
    if let Err(e) = crate::engine::placement::persist_recommendations(&state.pool, &recs).await {
        tracing::warn!("DRS: failed to persist placement recommendations: {e:#}");
    }

    for rec in recs.into_iter().take(3) {
        if rec.score < 20.0 {
            continue;
        }
        let (vm_id, dest_id) = match (Uuid::parse_str(&rec.vm_id), Uuid::parse_str(&rec.to_host_id)) {
            (Ok(v), Ok(d)) => (v, d),
            _ => {
                tracing::warn!(vm_id = %rec.vm_id, "DRS: malformed UUID in recommendation, skipping");
                continue;
            }
        };

        let pre = crate::engine::migrate_precheck::run_migrate_precheck(
            &state.pool,
            vm_id,
            dest_id,
            true,
        )
        .await?;
        if !pre.ok {
            continue;
        }

        let source_host: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();

        if let Err(e) = enqueue_task(
            state,
            "vm.migrate",
            serde_json::json!({
                "vm_id": rec.vm_id,
                "dest_host_id": rec.to_host_id,
                "live": true,
                "drs": true,
            }),
            Some("vm"),
            Some(vm_id),
            source_host,
        )
        .await
        {
            tracing::warn!(vm_id = %rec.vm_id, "DRS: failed to enqueue vm.migrate task: {e:?}");
        }

        state.emit_event(
            "drs.migrate",
            format!("Auto-migrating {} → {}", rec.vm_name, rec.to_host_name),
        );
    }
    Ok(())
}

pub async fn get_cluster_settings(pool: &SqlitePool) -> anyhow::Result<ClusterSettings> {
    sqlx::query_as(
        "SELECT drs_auto_migrate, drs_cpu_threshold, ha_enabled, placement_policy,
                inventory_sync_interval_secs, require_vm_delete_approval,
                firewall_approval_sla_hours,
                finops_vcpu_hour_usd, finops_gib_hour_usd
         FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("no cluster configured — run machina-controller bootstrap"))
}

pub async fn get_inventory_sync_interval_secs(pool: &SqlitePool) -> anyhow::Result<i32> {
    sqlx::query_scalar(
        "SELECT inventory_sync_interval_secs FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("no cluster configured — run machina-controller bootstrap"))
}

pub async fn update_cluster_settings(
    pool: &SqlitePool,
    settings: &ClusterSettingsPatch,
) -> anyhow::Result<()> {
    let cluster_id: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT id FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_optional(pool)
            .await?;
    let Some(cluster_id) = cluster_id else {
        return Ok(());
    };
    let mut tx = pool.begin().await?;
    if let Some(v) = settings.drs_auto_migrate {
        sqlx::query("UPDATE clusters SET drs_auto_migrate = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.drs_cpu_threshold {
        sqlx::query("UPDATE clusters SET drs_cpu_threshold = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.ha_enabled {
        sqlx::query("UPDATE clusters SET ha_enabled = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &settings.placement_policy {
        sqlx::query("UPDATE clusters SET placement_policy = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.inventory_sync_interval_secs {
        sqlx::query("UPDATE clusters SET inventory_sync_interval_secs = ? WHERE id = ?")
            .bind(v.clamp(0, 86400))
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.require_vm_delete_approval {
        sqlx::query("UPDATE clusters SET require_vm_delete_approval = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.firewall_approval_sla_hours {
        sqlx::query("UPDATE clusters SET firewall_approval_sla_hours = ? WHERE id = ?")
            .bind(v.clamp(1, 720))
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.finops_vcpu_hour_usd {
        sqlx::query("UPDATE clusters SET finops_vcpu_hour_usd = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = settings.finops_gib_hour_usd {
        sqlx::query("UPDATE clusters SET finops_gib_hour_usd = ? WHERE id = ?")
            .bind(v)
            .bind(cluster_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ClusterSettings {
    pub drs_auto_migrate: bool,
    pub drs_cpu_threshold: f32,
    pub ha_enabled: bool,
    pub placement_policy: String,
    pub inventory_sync_interval_secs: i32,
    pub require_vm_delete_approval: bool,
    pub firewall_approval_sla_hours: i32,
    pub finops_vcpu_hour_usd: f64,
    pub finops_gib_hour_usd: f64,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ClusterSettingsPatch {
    pub drs_auto_migrate: Option<bool>,
    pub drs_cpu_threshold: Option<f32>,
    pub ha_enabled: Option<bool>,
    pub placement_policy: Option<String>,
    pub inventory_sync_interval_secs: Option<i32>,
    pub require_vm_delete_approval: Option<bool>,
    pub firewall_approval_sla_hours: Option<i32>,
    pub finops_vcpu_hour_usd: Option<f64>,
    pub finops_gib_hour_usd: Option<f64>,
}

pub async fn fence_host(state: &AppState, host_id: Uuid) -> anyhow::Result<bool> {
    let row: (String, String, String, String, String, String) = sqlx::query_as(
        "SELECT hostname, agent_grpc_addr, COALESCE(fence_method, 'shell'), COALESCE(ipmi_address, ''),
                COALESCE(ipmi_username, ''), COALESCE(ipmi_password, '') FROM hosts WHERE id = ?",
    )
    .bind(host_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("host {} not found — may have been removed while HA was scanning", host_id))?;

    let shell_cmd = std::env::var("MACHINA_FENCE_COMMAND").unwrap_or_default();
    let mut client = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        agent_client::connect(&row.1),
    )
    .await
    .map_err(|_| anyhow::anyhow!(
        "agent on {} ({}) unreachable; configure IPMI fencing for reliable isolation of unresponsive hosts",
        row.0, row.1
    ))??;
    let resp = agent_client::fence_host(
        &mut client,
        &row.0,
        &row.2,
        &row.3,
        &row.4,
        &row.5,
        &shell_cmd,
    )
    .await?;

    sqlx::query(
        "INSERT INTO fence_events (id, host_id, action, command, success, message)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(host_id)
    .bind(if row.2 == "ipmi" {
        "ipmi-fence"
    } else {
        "fence"
    })
    .bind(if row.2 == "ipmi" {
        format!("ipmitool -H {} power off", row.3)
    } else {
        shell_cmd.clone()
    })
    .bind(resp.ok)
    .bind(&resp.message)
    .execute(&state.pool)
    .await?;

    if resp.ok {
        sqlx::query("UPDATE hosts SET fenced = TRUE WHERE id = ?")
            .bind(host_id)
            .execute(&state.pool)
            .await?;
    }
    Ok(resp.ok)
}
