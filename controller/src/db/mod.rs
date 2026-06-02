// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(16)
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> anyhow::Result<()> {
    for name in [
        "001_platform.sql",
        "002_platform_extras.sql",
        "003_ha_placement.sql",
        "004_drs_fence.sql",
        "005_platform_ops.sql",
        "006_platform_batch6.sql",
        "007_platform_batch7.sql",
        "008_platform_ha_oidc.sql",
        "009_platform_batch11.sql",
        "010_platform_batch12.sql",
        "011_platform_batch15.sql",
        "012_platform_batch17.sql",
        "013_platform_batch24.sql",
        "014_platform_batch30.sql",
        "015_platform_batch31_40.sql",
        "016_platform_ai.sql",
        "017_ai_v5.sql",
        "018_ai_v8.sql",
        "019_baremetal.sql",
        "020_zeus_firewall.sql",
        "021_template_firewall.sql",
        "022_firewall_phase15.sql",
        "023_firewall_phases16_25.sql",
        "024_baremetal_firewall.sql",
        "025_multisite_firewall.sql",
        "026_network_overlays.sql",
        "027_platform_plugins.sql",
        "028_storage_tiers.sql",
        "029_enterprise_security.sql",
        "030_lldp_cache.sql",
        "031_operations.sql",
        "032_observability.sql",
        "033_enterprise_hardening.sql",
        "034_host_geography.sql",
        "035_vm_inventory_reconcile.sql",
        "036_zeus_ai_redesign.sql",
    ] {
        let sql = match name {
            "001_platform.sql" => include_str!("../../migrations/001_platform.sql"),
            "002_platform_extras.sql" => include_str!("../../migrations/002_platform_extras.sql"),
            "003_ha_placement.sql" => include_str!("../../migrations/003_ha_placement.sql"),
            "004_drs_fence.sql" => include_str!("../../migrations/004_drs_fence.sql"),
            "005_platform_ops.sql" => include_str!("../../migrations/005_platform_ops.sql"),
            "006_platform_batch6.sql" => include_str!("../../migrations/006_platform_batch6.sql"),
            "007_platform_batch7.sql" => include_str!("../../migrations/007_platform_batch7.sql"),
            "008_platform_ha_oidc.sql" => include_str!("../../migrations/008_platform_ha_oidc.sql"),
            "009_platform_batch11.sql" => include_str!("../../migrations/009_platform_batch11.sql"),
            "010_platform_batch12.sql" => include_str!("../../migrations/010_platform_batch12.sql"),
            "011_platform_batch15.sql" => include_str!("../../migrations/011_platform_batch15.sql"),
            "012_platform_batch17.sql" => include_str!("../../migrations/012_platform_batch17.sql"),
            "013_platform_batch24.sql" => include_str!("../../migrations/013_platform_batch24.sql"),
            "014_platform_batch30.sql" => include_str!("../../migrations/014_platform_batch30.sql"),
            "015_platform_batch31_40.sql" => include_str!("../../migrations/015_platform_batch31_40.sql"),
            "016_platform_ai.sql" => include_str!("../../migrations/016_platform_ai.sql"),
            "017_ai_v5.sql" => include_str!("../../migrations/017_ai_v5.sql"),
            "018_ai_v8.sql" => include_str!("../../migrations/018_ai_v8.sql"),
            "019_baremetal.sql" => include_str!("../../migrations/019_baremetal.sql"),
            "020_zeus_firewall.sql" => include_str!("../../migrations/020_zeus_firewall.sql"),
            "021_template_firewall.sql" => include_str!("../../migrations/021_template_firewall.sql"),
            "022_firewall_phase15.sql" => include_str!("../../migrations/022_firewall_phase15.sql"),
            "023_firewall_phases16_25.sql" => include_str!("../../migrations/023_firewall_phases16_25.sql"),
            "024_baremetal_firewall.sql" => include_str!("../../migrations/024_baremetal_firewall.sql"),
            "025_multisite_firewall.sql" => include_str!("../../migrations/025_multisite_firewall.sql"),
            "026_network_overlays.sql" => include_str!("../../migrations/026_network_overlays.sql"),
            "027_platform_plugins.sql" => include_str!("../../migrations/027_platform_plugins.sql"),
            "028_storage_tiers.sql" => include_str!("../../migrations/028_storage_tiers.sql"),
            "029_enterprise_security.sql" => include_str!("../../migrations/029_enterprise_security.sql"),
            "030_lldp_cache.sql" => include_str!("../../migrations/030_lldp_cache.sql"),
            "031_operations.sql" => include_str!("../../migrations/031_operations.sql"),
            "032_observability.sql" => include_str!("../../migrations/032_observability.sql"),
            "033_enterprise_hardening.sql" => include_str!("../../migrations/033_enterprise_hardening.sql"),
            "034_host_geography.sql" => include_str!("../../migrations/034_host_geography.sql"),
            "035_vm_inventory_reconcile.sql" => include_str!("../../migrations/035_vm_inventory_reconcile.sql"),
            "036_zeus_ai_redesign.sql" => include_str!("../../migrations/036_zeus_ai_redesign.sql"),
            _ => continue,
        };
        for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            sqlx::query(stmt).execute(pool).await?;
        }
    }
    Ok(())
}

pub async fn ensure_bootstrap(
    pool: &PgPool,
    admin_user: &str,
    admin_password: &str,
) -> anyhow::Result<()> {
    let cluster_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clusters")
        .fetch_one(pool)
        .await?;
    if cluster_count == 0 {
        let cluster_id = Uuid::new_v4();
        sqlx::query("INSERT INTO clusters (id, name) VALUES ($1, $2)")
            .bind(cluster_id)
            .bind("default")
            .execute(pool)
            .await?;
    }

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    if user_count == 0 {
        let hash = bcrypt::hash(admin_password, bcrypt::DEFAULT_COST)?;
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4())
        .bind(admin_user)
        .bind(hash)
        .bind("admin")
        .execute(pool)
        .await?;
    }

    let host_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(pool)
        .await?;
    if host_count == 0 {
        let cluster_id: Uuid = sqlx::query_scalar("SELECT id FROM clusters LIMIT 1")
            .fetch_one(pool)
            .await?;
        sqlx::query(
            "INSERT INTO hosts (id, cluster_id, hostname, address, state, agent_grpc_addr)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(cluster_id)
        .bind("localhost")
        .bind("127.0.0.1")
        .bind("online")
        .bind(
            std::env::var("MACHINA_AGENT_ADDR").unwrap_or_else(|_| "http://127.0.0.1:50051".into()),
        )
        .execute(pool)
        .await?;
    }

    crate::engine::template_catalog::ensure_default_templates(pool).await?;

    Ok(())
}
