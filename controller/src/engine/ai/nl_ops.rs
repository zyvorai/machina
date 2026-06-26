// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::actions::{self, CreateActionBody};
use super::environment_intent;
use super::infra_graph::{self, GraphQueryRequest};
use super::predictions;
use super::troubleshoot;

#[derive(Debug, Deserialize)]
pub struct NlOpsRequest {
    pub query: String,
    #[serde(default = "default_dry_run")]
    pub dry_run: bool,
}

fn default_dry_run() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct NlOpsStep {
    pub label: String,
    pub action_type: String,
    pub review: String,
    pub risk: String,
}

#[derive(Debug, Serialize)]
pub struct NlOpsPlan {
    pub intent: String,
    pub summary: String,
    pub steps: Vec<NlOpsStep>,
    pub risk_score: u8,
    pub dry_run: bool,
    pub approval_required: bool,
    pub action_ids: Vec<Uuid>,
    pub reply: String,
}

pub async fn execute(pool: &SqlitePool, req: &NlOpsRequest, actor: &str) -> anyhow::Result<NlOpsPlan> {
    let q = req.query.trim();
    let ql = q.to_lowercase();

    // Create VMs
    if ql.contains("create") && (ql.contains("vm") || ql.contains("ubuntu")) {
        let count = extract_count(&ql).unwrap_or(1);
        let rates: (f64, f64) = sqlx::query_as(
            "SELECT finops_vcpu_hour_usd, finops_gib_hour_usd FROM clusters ORDER BY created_at LIMIT 1",
        )
        .fetch_one(pool)
        .await
        .unwrap_or((0.02, 0.005));
        let plan = environment_intent::plan_environment(q, rates.0, rates.1);
        let mut steps = Vec::new();
        for i in 0..count.min(plan.vm_count) {
            steps.push(NlOpsStep {
                label: format!("Create VM {i}"),
                action_type: "create_vm".into(),
                review: plan.label.clone(),
                risk: "medium".into(),
            });
        }
        let mut action_ids = Vec::new();
        if !req.dry_run {
            for step in &steps {
                let row = actions::create_action(
                    pool,
                    &CreateActionBody {
                        action_type: step.action_type.clone(),
                        label: step.label.clone(),
                        review: step.review.clone(),
                        risk: step.risk.clone(),
                        object_ref: serde_json::json!({}),
                        source: "nl_ops".into(),
                    },
                    actor,
                )
                .await?;
                action_ids.push(row.id);
            }
        }
        return Ok(NlOpsPlan {
            intent: "create_vms".into(),
            summary: format!("Create {count} VM(s) from environment plan"),
            steps,
            risk_score: 6,
            dry_run: req.dry_run,
            approval_required: true,
            action_ids,
            reply: plan.label.clone(),
        });
    }

    // Migrate all VMs from host
    if ql.contains("migrate") && ql.contains("from") {
        let host_hint = extract_host_hint(&ql);
        let vms: Vec<(Uuid, String)> = if let Some(h) = &host_hint {
            let escaped = h.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            sqlx::query_as(
                "SELECT v.id, v.name FROM vms v JOIN hosts h ON h.id = v.host_id
                 WHERE h.hostname LIKE ? ESCAPE '\\'",
            )
            .bind(format!("%{escaped}%"))
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as("SELECT id, name FROM vms WHERE observed_state = 'running' LIMIT 10")
                .fetch_all(pool)
                .await?
        };
        let mut steps = Vec::new();
        for (id, name) in &vms {
            steps.push(NlOpsStep {
                label: format!("Migrate {name}"),
                action_type: "migrate_vm".into(),
                review: format!("Live migrate VM {name} ({id}) off source host"),
                risk: "high".into(),
            });
        }
        let mut action_ids = Vec::new();
        if !req.dry_run {
            for step in &steps {
                let row = actions::create_action(
                    pool,
                    &CreateActionBody {
                        action_type: step.action_type.clone(),
                        label: step.label.clone(),
                        review: step.review.clone(),
                        risk: step.risk.clone(),
                        object_ref: serde_json::json!({}),
                        source: "nl_ops".into(),
                    },
                    actor,
                )
                .await?;
                action_ids.push(row.id);
            }
        }
        return Ok(NlOpsPlan {
            intent: "migrate_vms_from_host".into(),
            summary: format!(
                "Migrate {} VM(s) from {}",
                vms.len(),
                host_hint.unwrap_or_else(|| "fleet".into())
            ),
            steps,
            risk_score: 8,
            dry_run: req.dry_run,
            approval_required: true,
            action_ids,
            reply: format!(
                "Prepared {} migration(s) — approve in Zeus queue.",
                vms.len()
            ),
        });
    }

    // Why is storage slow
    if ql.contains("storage") && (ql.contains("slow") || ql.contains("latency")) {
        let cap = super::capacity::plan(pool).await?;
        let preds = predictions::unified(pool).await?;
        let storage_msg = preds
            .predictions
            .iter()
            .find(|p| p.kind.contains("storage") || p.resource_kind == "storage")
            .map(|p| p.message.clone());
        return Ok(NlOpsPlan {
            intent: "explain_slow_storage".into(),
            summary: "Storage performance analysis".into(),
            steps: vec![NlOpsStep {
                label: "Review storage pools".into(),
                action_type: "navigate".into(),
                review: format!(
                    "Used {:.0} GiB / {:.0} GiB — runway {:?} days",
                    cap.storage_used_gib, cap.storage_capacity_gib, cap.storage_runway_days
                ),
                risk: "low".into(),
            }],
            risk_score: if storage_msg.is_some() { 7 } else { 3 },
            dry_run: true,
            approval_required: false,
            action_ids: vec![],
            reply: storage_msg.unwrap_or_else(|| {
                format!(
                    "Storage: {:.0}/{:.0} GiB used. Check pool latency and SMART on hosts.",
                    cap.storage_used_gib, cap.storage_capacity_gib
                )
            }),
        });
    }

    // Show risky infrastructure
    if ql.contains("risky") || ql.contains("risk") {
        let preds = predictions::unified(pool).await?;
        let cost = super::cost::analyze(pool).await?;
        return Ok(NlOpsPlan {
            intent: "show_risky_infra".into(),
            summary: "Risk rollup".into(),
            steps: preds
                .predictions
                .iter()
                .take(5)
                .map(|p| NlOpsStep {
                    label: p.message.clone(),
                    action_type: "alert".into(),
                    review: p.evidence.clone(),
                    risk: p.severity.clone(),
                })
                .collect(),
            risk_score: 5,
            dry_run: true,
            approval_required: false,
            action_ids: vec![],
            reply: format!(
                "{} prediction(s); {} idle VMs; {} oversized.",
                preds.predictions.len(),
                cost.idle_vm_count,
                cost.oversized_vm_count
            ),
        });
    }

    // VM is slow — troubleshoot
    if ql.contains("slow") {
        if let Some(name) = extract_vm_name(&ql) {
            let report = troubleshoot::diagnose(
                pool,
                &troubleshoot::TroubleshootRequest {
                    vm_id: None,
                    vm_name: Some(name.clone()),
                    symptom: "slow".into(),
                },
            )
            .await?;
            return Ok(NlOpsPlan {
                intent: "troubleshoot_vm".into(),
                summary: format!("Diagnosis for {name}"),
                steps: report
                    .findings
                    .iter()
                    .map(|f| NlOpsStep {
                        label: f.message.clone(),
                        action_type: "finding".into(),
                        review: f.domain.clone(),
                        risk: f.severity.clone(),
                    })
                    .collect(),
                risk_score: match report.severity.as_str() {
                    "critical" => 9,
                    "high" => 7,
                    _ => 4,
                },
                dry_run: true,
                approval_required: false,
                action_ids: vec![],
                reply: report
                    .findings
                    .first()
                    .map(|f| f.message.clone())
                    .unwrap_or_else(|| "No dominant finding.".into()),
            });
        }
    }

    // Infrastructure search fallback
    let hits = infra_graph::query(pool, &GraphQueryRequest { query: q.into() }).await?;
    Ok(NlOpsPlan {
        intent: "search".into(),
        summary: format!("{} result(s)", hits.hits.len()),
        steps: hits
            .hits
            .iter()
            .take(8)
            .map(|h| NlOpsStep {
                label: h.name.clone(),
                action_type: "navigate".into(),
                review: h.detail.clone(),
                risk: "low".into(),
            })
            .collect(),
        risk_score: 1,
        dry_run: true,
        approval_required: false,
        action_ids: vec![],
        reply: format!("Found {} matching resources.", hits.hits.len()),
    })
}

fn extract_count(ql: &str) -> Option<i32> {
    for word in ql.split_whitespace() {
        if let Ok(n) = word.parse::<i32>() {
            if (1..=50).contains(&n) {
                return Some(n);
            }
        }
    }
    if ql.contains("ten") || ql.contains("10") {
        Some(10)
    } else if ql.contains("three") || ql.contains("3") {
        Some(3)
    } else {
        None
    }
}

fn extract_host_hint(ql: &str) -> Option<String> {
    if let Some(idx) = ql.find("host") {
        let rest = &ql[idx..];
        for word in rest.split_whitespace() {
            if word.starts_with("host-") || word.contains('-') {
                return Some(
                    word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-')
                        .into(),
                );
            }
        }
    }
    None
}

fn extract_vm_name(ql: &str) -> Option<String> {
    for word in ql.split_whitespace() {
        if word.contains('-') && !word.starts_with("host") {
            return Some(word.into());
        }
    }
    None
}
