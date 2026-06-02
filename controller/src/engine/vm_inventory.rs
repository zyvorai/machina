// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::collections::HashSet;

use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;

const DOMAIN_MISSING: &str = "domain_not_found: VM no longer present on hypervisor inventory scan";

#[derive(Debug, sqlx::FromRow)]
pub struct ClusterInventoryPolicy {
    pub inventory_prune_unmanaged: bool,
    pub inventory_mark_managed_missing: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct VmInventoryRow {
    id: Uuid,
    name: String,
    managed: bool,
}

pub async fn cluster_inventory_policy(pool: &PgPool, cluster_id: Uuid) -> anyhow::Result<ClusterInventoryPolicy> {
    let row = sqlx::query_as::<_, ClusterInventoryPolicy>(
        "SELECT inventory_prune_unmanaged, inventory_mark_managed_missing FROM clusters WHERE id = $1",
    )
    .bind(cluster_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or(ClusterInventoryPolicy {
        inventory_prune_unmanaged: true,
        inventory_mark_managed_missing: true,
    }))
}

/// Remove or mark libvirt VMs on `host_id` that were not seen in the latest agent inventory.
pub async fn reconcile_libvirt_host(
    state: &AppState,
    host_id: Uuid,
    cluster_id: Uuid,
    seen_names: &HashSet<String>,
) -> anyhow::Result<()> {
    let policy = cluster_inventory_policy(&state.pool, cluster_id).await?;
    let rows: Vec<VmInventoryRow> = sqlx::query_as(
        "SELECT id, name, managed FROM vms
         WHERE host_id = $1 AND inventory_source = 'libvirt'",
    )
    .bind(host_id)
    .fetch_all(&state.pool)
    .await?;

    for row in rows {
        if seen_names.contains(&row.name) {
            continue;
        }
        if !row.managed && policy.inventory_prune_unmanaged {
            sqlx::query("DELETE FROM vms WHERE id = $1")
                .bind(row.id)
                .execute(&state.pool)
                .await?;
            state.emit_event(
                "vm.removed",
                format!("Discovered VM '{}' removed — absent from hypervisor", row.name),
            );
        } else if row.managed && policy.inventory_mark_managed_missing {
            sqlx::query(
                "UPDATE vms SET observed_state = 'missing', last_error = $1, updated_at = NOW() WHERE id = $2",
            )
            .bind(DOMAIN_MISSING)
            .bind(row.id)
            .execute(&state.pool)
            .await?;
            state.emit_event(
                "vm.missing",
                format!("VM '{}' missing from hypervisor inventory", row.name),
            );
        } else {
            tracing::debug!(
                vm = %row.name,
                host_id = %host_id,
                "inventory: VM absent from hypervisor but policy kept row"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_missing_message_stable() {
        assert!(DOMAIN_MISSING.contains("domain_not_found"));
    }
}
