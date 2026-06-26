// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::profiles::plan_for_profile;
use crate::config::ControllerConfig;
use crate::engine::zeus_firewall::inventory::apply_target;

#[derive(Debug, Clone, Serialize)]
pub struct LockdownPreview {
    pub summary: String,
    pub actions: Vec<String>,
    pub capture_packetwolf: bool,
    pub create_incident: bool,
}

pub fn lockdown_preview(capture: bool) -> LockdownPreview {
    LockdownPreview {
        summary: "Emergency Isolation will block all traffic except Zeus management, console, and backup/forensics networks".into(),
        actions: vec![
            "Apply EmergencyIsolation profile".into(),
            "Preserve current logs".into(),
            "Create rollback checkpoint".into(),
            if capture {
                "Start PacketWolf capture".into()
            } else {
                "Skip PacketWolf capture".into()
            },
            "Create security incident event".into(),
        ],
        capture_packetwolf: capture,
        create_incident: true,
    }
}

pub async fn lockdown_target(
    pool: &SqlitePool,
    cfg: &ControllerConfig,
    target_id: &str,
    capture: bool,
    actor: &str,
) -> anyhow::Result<serde_json::Value> {
    let plan = plan_for_profile("EmergencyIsolation", false)?;
    let result = apply_target(pool, cfg, target_id, plan, actor).await?;
    if capture {
        let _ = crate::engine::packetwolf_bridge::start_capture(cfg, target_id).await;
    }
    if let Ok(host_id) = Uuid::parse_str(target_id) {
        let _ = sqlx::query(
            "INSERT INTO events (id, kind, message, resource_type, resource_id, payload) VALUES (?, 'security', ?, 'host', ?, '{\"severity\":\"critical\"}')",
        )
        .bind(uuid::Uuid::new_v4())
        .bind("Zeus Lockdown enabled — Emergency Isolation")
        .bind(host_id)
        .execute(pool)
        .await;
    }
    Ok(serde_json::json!({
        "ok": true,
        "preview": lockdown_preview(capture),
        "result": result
    }))
}
