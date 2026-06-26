// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct DiagnoseHypothesis {
    pub title: String,
    pub confidence: f32,
    pub evidence: String,
    pub action: String,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeDiagnosis {
    pub query: String,
    pub summary: String,
    pub hypotheses: Vec<DiagnoseHypothesis>,
    pub related_vm_count: i64,
    pub failed_task_count: i64,
}

pub async fn diagnose(pool: &SqlitePool, query: &str) -> anyhow::Result<KnowledgeDiagnosis> {
    let q = query.trim();
    let ql = q.to_lowercase();
    let pattern = format!("%{q}%");

    let related_vm_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vms WHERE name LIKE ? OR EXISTS (SELECT 1 FROM json_each(COALESCE(tags,'[]')) WHERE value = ?)")
            .bind(&pattern)
            .bind(q)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let failed_task_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND (operation LIKE ? OR created_at > datetime('now', '-7 days'))",
    )
    .bind(&pattern)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let high_cpu_vms: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vms v JOIN vm_metrics m ON m.vm_id = v.id WHERE m.cpu_percent > 85",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let mut hypotheses = Vec::new();

    if ql.contains("slow")
        || ql.contains("latency")
        || ql.contains("billing")
        || ql.contains("payment")
    {
        hypotheses.push(DiagnoseHypothesis {
            title: "Database or API saturation".into(),
            confidence: 0.78,
            evidence: format!(
                "{related_vm_count} matching VM(s); {failed_task_count} recent failed tasks"
            ),
            action: "Check VM metrics, storage pool free space, and network path to DB tier."
                .into(),
        });
        if high_cpu_vms > 0 {
            hypotheses.push(DiagnoseHypothesis {
                title: "Hotspot VMs consuming CPU".into(),
                confidence: 0.65,
                evidence: format!("{high_cpu_vms} VM(s) above 85% CPU"),
                action: "Open Zeus SRE on top consumers; consider rebalance.".into(),
            });
        }
    }

    if ql.contains("down") || ql.contains("unreachable") || ql.contains("offline") {
        hypotheses.push(DiagnoseHypothesis {
            title: "Host or network path failure".into(),
            confidence: 0.82,
            evidence: "Correlate host state, fence events, and recent migrations.".into(),
            action: "Run Digital Twin impact simulation and check HA policies.".into(),
        });
    }

    if hypotheses.is_empty() {
        let hits = super::knowledge_search::search(pool, q).await?;
        hypotheses.push(DiagnoseHypothesis {
            title: "Infrastructure search correlation".into(),
            confidence: 0.55,
            evidence: format!("{} knowledge hit(s) for query", hits.hits.len()),
            action: "Review linked VMs, tasks, and audit entries in Knowledge tab.".into(),
        });
    }

    let summary = format!(
        "Diagnosis for '{q}' — {} hypothesis(es), {related_vm_count} VM(s), {failed_task_count} failed task(s) in scope",
        hypotheses.len()
    );

    Ok(KnowledgeDiagnosis {
        query: q.into(),
        summary,
        hypotheses,
        related_vm_count,
        failed_task_count,
    })
}
