// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use machina_spec::PlacementRecommendation;
use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct HostLoad {
    id: Uuid,
    hostname: String,
    cpu_percent: f32,
    memory_used_mib: i64,
    memory_total_mib: i64,
    vm_count: i32,
    tags: sqlx::types::Json<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlacementRecommendationRow {
    pub vm_id: String,
    pub vm_name: String,
    pub from_host_id: String,
    pub from_host_name: String,
    pub to_host_id: String,
    pub to_host_name: String,
    pub reason: String,
    pub score: f32,
}

pub async fn compute_recommendations(
    pool: &SqlitePool,
) -> anyhow::Result<Vec<PlacementRecommendationRow>> {
    let threshold: f32 =
        sqlx::query_scalar("SELECT drs_cpu_threshold FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap_or(85.0);

    let placement_policy: String =
        sqlx::query_scalar("SELECT placement_policy FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|_| "balanced".into());

    let hosts: Vec<HostLoad> = sqlx::query_as(
        "SELECT id, hostname, cpu_percent, memory_used_mib, memory_total_mib, vm_count,
                COALESCE(tags, '[]') AS tags
         FROM hosts WHERE state = 'online' AND maintenance_mode = FALSE",
    )
    .fetch_all(pool)
    .await?;

    if hosts.len() < 2 {
        return Ok(Vec::new());
    }

    let vms: Vec<(Uuid, String, Uuid, i64, sqlx::types::Json<Vec<String>>)> = sqlx::query_as(
        "SELECT v.id, v.name, v.host_id, v.memory_mib, COALESCE(v.tags, '[]') AS tags FROM vms v
         JOIN hosts h ON h.id = v.host_id
         WHERE v.desired_state = 'running' AND h.state = 'online'",
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::new();

    for (vm_id, vm_name, host_id, memory_mib, vm_tags) in vms {
        let Some(source) = hosts.iter().find(|h| h.id == host_id) else {
            continue;
        };
        let mem_pct = pct(source.memory_used_mib, source.memory_total_mib);
        if source.cpu_percent < threshold && mem_pct < threshold {
            continue;
        }

        let mut best: Option<(&HostLoad, f32)> = None;
        for dest in &hosts {
            if dest.id == host_id {
                continue;
            }
            let dest_mem_pct = pct(dest.memory_used_mib, dest.memory_total_mib);
            let mut score = dest_score(
                &placement_policy,
                dest.cpu_percent,
                dest_mem_pct,
                dest.vm_count,
            );
            score += tag_affinity_score(&*vm_tags, &*dest.tags);
            if score <= 0.0 {
                continue;
            }
            if best.map(|(_, s)| score > s).unwrap_or(true) {
                best = Some((dest, score));
            }
        }

        let Some((dest, score)) = best else { continue };

        let reason = format!(
            "{} memory {:.0}%, CPU {:.0}% — move to {} (memory {:.0}%, CPU {:.0}%)",
            source.hostname,
            mem_pct,
            source.cpu_percent,
            dest.hostname,
            pct(dest.memory_used_mib, dest.memory_total_mib),
            dest.cpu_percent,
        );

        out.push(PlacementRecommendationRow {
            vm_id: vm_id.to_string(),
            vm_name,
            from_host_id: source.id.to_string(),
            from_host_name: source.hostname.clone(),
            to_host_id: dest.id.to_string(),
            to_host_name: dest.hostname.clone(),
            reason,
            score,
        });

        let _ = memory_mib;
    }

    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

pub async fn persist_recommendations(
    pool: &SqlitePool,
    rows: &[PlacementRecommendationRow],
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE placement_recommendations SET status = 'superseded' WHERE status = 'open'")
        .execute(&mut *tx)
        .await?;

    for row in rows.iter().take(50) {
        sqlx::query(
            "INSERT INTO placement_recommendations (id, vm_id, from_host_id, to_host_id, reason, score)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(Uuid::parse_str(&row.vm_id)?)
        .bind(Uuid::parse_str(&row.from_host_id)?)
        .bind(Uuid::parse_str(&row.to_host_id)?)
        .bind(&row.reason)
        .bind(row.score)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub fn to_spec_rows(rows: &[PlacementRecommendationRow]) -> Vec<PlacementRecommendation> {
    rows.iter()
        .map(|r| PlacementRecommendation {
            vm_id: r.vm_id.clone(),
            vm_name: r.vm_name.clone(),
            from_host_id: r.from_host_id.clone(),
            to_host_id: r.to_host_id.clone(),
            reason: r.reason.clone(),
        })
        .collect()
}

fn pct(used: i64, total: i64) -> f32 {
    if total <= 0 {
        return 0.0;
    }
    (used as f32 / total as f32) * 100.0
}

fn headroom_score(cpu: f32, mem_pct: f32, vm_count: i32) -> f32 {
    let base = (100.0 - cpu).max(0.0) + (100.0 - mem_pct).max(0.0);
    base - (vm_count as f32 * 2.0)
}

fn dest_score(policy: &str, cpu: f32, mem_pct: f32, vm_count: i32) -> f32 {
    match policy {
        "packed" => {
            let headroom = headroom_score(cpu, mem_pct, vm_count);
            if headroom < 10.0 {
                return 0.0;
            }
            (vm_count as f32 * 15.0) + headroom * 0.5
        }
        _ => headroom_score(cpu, mem_pct, vm_count),
    }
}

#[derive(Debug, sqlx::FromRow)]
struct HostCandidate {
    id: Uuid,
    cpu_percent: f32,
    memory_used_mib: i64,
    memory_total_mib: i64,
    vm_count: i32,
    tags: sqlx::types::Json<Vec<String>>,
}

pub async fn pick_host_for_vm(
    pool: &SqlitePool,
    vm_tags: &[String],
    _memory_mib: i64,
) -> anyhow::Result<Uuid> {
    let placement_policy: String =
        sqlx::query_scalar("SELECT placement_policy FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|_| "balanced".into());

    let hosts: Vec<HostCandidate> = sqlx::query_as(
        "SELECT id, cpu_percent, memory_used_mib, memory_total_mib, vm_count,
                COALESCE(tags, '[]') AS tags
         FROM hosts WHERE state = 'online' AND maintenance_mode = FALSE",
    )
    .fetch_all(pool)
    .await?;

    if hosts.is_empty() {
        anyhow::bail!("no online hosts available");
    }

    let mut best: Option<(Uuid, f32)> = None;
    for h in &hosts {
        let mem_pct = pct(h.memory_used_mib, h.memory_total_mib);
        let mut score = dest_score(&placement_policy, h.cpu_percent, mem_pct, h.vm_count);
        if score <= 0.0 {
            continue;
        }
        score += tag_affinity_score(vm_tags, &*h.tags);
        if best.map(|(_, s)| score > s).unwrap_or(true) {
            best = Some((h.id, score));
        }
    }

    best.map(|(id, _)| id)
        .ok_or_else(|| anyhow::anyhow!("no suitable host for placement"))
}

fn tag_affinity_score(vm_tags: &[String], host_tags: &[String]) -> f32 {
    if vm_tags.is_empty() || host_tags.is_empty() {
        return 0.0;
    }
    let overlap = vm_tags.iter().filter(|t| host_tags.contains(t)).count();
    overlap as f32 * 25.0
}
