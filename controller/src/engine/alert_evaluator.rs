// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//
// Day-2: threshold alert-rule evaluator. Periodically checks user-defined alert_rules
// against current vm_metrics and, when a rule is violated, emits a notification through
// the existing notification_outbox (delivered by webhook_worker). A per-rule cooldown
// prevents alert storms.

use uuid::Uuid;

use crate::state::AppState;

struct Rule {
    id: Uuid,
    name: String,
    metric: String,
    comparator: String,
    threshold: f64,
    severity: String,
    scope_project: String,
    scope_tag: String,
}

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if !state.leader.is_leader() {
                continue;
            }
            if let Err(e) = tick(&state).await {
                tracing::warn!("alert evaluator: {e:#}");
            }
        }
    });
}

async fn tick(state: &AppState) -> anyhow::Result<()> {
    // Only rules whose cooldown has elapsed (or never fired) are eligible this tick.
    let rows: Vec<(Uuid, String, String, String, f64, String, String, String)> = sqlx::query_as(
        "SELECT id, name, metric, comparator, threshold, severity, scope_project, scope_tag
         FROM alert_rules
         WHERE enabled = TRUE
           AND (last_fired_at IS NULL
                OR last_fired_at < datetime('now', printf('-%d minutes', cooldown_minutes)))",
    )
    .fetch_all(&state.pool)
    .await?;

    for (id, name, metric, comparator, threshold, severity, scope_project, scope_tag) in rows {
        let rule = Rule {
            id,
            name,
            metric,
            comparator,
            threshold,
            severity,
            scope_project,
            scope_tag,
        };
        let violations = evaluate_rule(state, &rule).await?;
        if !violations.is_empty() {
            fire(state, &rule, &violations).await?;
        }
    }
    Ok(())
}

/// Return (vm_name, metric_value) for every scoped VM currently violating the rule.
async fn evaluate_rule(state: &AppState, rule: &Rule) -> anyhow::Result<Vec<(String, f64)>> {
    // mem_percent is derived from used vs configured memory; cpu_percent is direct.
    let base = "SELECT v.name,
                       m.cpu_percent AS cpu_percent,
                       CASE WHEN v.memory_mib > 0
                            THEN (m.memory_used_mib * 100.0 / v.memory_mib) ELSE 0 END AS mem_percent
                FROM vms v JOIN vm_metrics m ON m.vm_id = v.id
                WHERE v.lifecycle_phase NOT IN ('retired', 'deleting')";
    let rows: Vec<(String, f64, f64)> =
        if !rule.scope_project.is_empty() && !rule.scope_tag.is_empty() {
            sqlx::query_as(&format!(
                "{base} AND v.project = ? AND EXISTS (SELECT 1 FROM json_each(COALESCE(v.tags,'[]')) WHERE value = ?)"
            ))
            .bind(&rule.scope_project)
            .bind(&rule.scope_tag)
            .fetch_all(&state.pool)
            .await?
        } else if !rule.scope_project.is_empty() {
            sqlx::query_as(&format!("{base} AND v.project = ?"))
                .bind(&rule.scope_project)
                .fetch_all(&state.pool)
                .await?
        } else {
            sqlx::query_as(base).fetch_all(&state.pool).await?
        };

    let mut out = Vec::new();
    for (name, cpu_percent, mem_percent) in rows {
        let value = match rule.metric.as_str() {
            "mem_percent" => mem_percent,
            _ => cpu_percent, // default cpu_percent
        };
        let violated = match rule.comparator.as_str() {
            "lt" => value < rule.threshold,
            _ => value > rule.threshold, // default gt
        };
        if violated {
            out.push((name, value));
        }
    }
    Ok(out)
}

async fn fire(state: &AppState, rule: &Rule, violations: &[(String, f64)]) -> anyhow::Result<()> {
    let payload = serde_json::json!({
        "rule_id": rule.id.to_string(),
        "rule": rule.name,
        "metric": rule.metric,
        "comparator": rule.comparator,
        "threshold": rule.threshold,
        "severity": rule.severity,
        "violations": violations.iter()
            .map(|(vm, v)| serde_json::json!({ "vm": vm, "value": v }))
            .collect::<Vec<_>>(),
        "count": violations.len(),
    });
    let kind = format!("alert.{}", rule.severity);
    // Route through the central dispatcher: in-app notification_outbox + signed webhooks +
    // notification channels (Slack/email/webhook), each filtered by its event list.
    crate::engine::webhooks::dispatch_webhooks(&state.pool, &kind, payload).await;
    sqlx::query("UPDATE alert_rules SET last_fired_at = datetime('now') WHERE id = ?")
        .bind(rule.id)
        .execute(&state.pool)
        .await?;
    state.emit_event(
        &kind,
        format!(
            "Alert '{}' fired: {} VM(s) {} {} {}",
            rule.name,
            violations.len(),
            rule.metric,
            rule.comparator,
            rule.threshold
        ),
    );
    Ok(())
}
