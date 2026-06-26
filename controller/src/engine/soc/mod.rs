// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

pub mod asm;
pub mod detection;
pub mod ingest;
pub mod playbooks;
pub mod siem;
pub mod worker;

pub use asm::build_asm_summary;
pub use detection::run_detection;
pub use ingest::{ingest_recent, IngestStats};
pub use playbooks::run_playbooks_for_alert;
pub use siem::forward_all_integrations;

use crate::config::ControllerConfig;
use sqlx::SqlitePool;

#[derive(Debug, serde::Serialize)]
pub struct CycleStats {
    pub ingest: IngestStats,
    pub alerts_fired: usize,
    pub forwarded: usize,
}

pub async fn run_cycle(
    pool: &SqlitePool,
    cfg: &ControllerConfig,
    controller_id: &str,
) -> anyhow::Result<CycleStats> {
    let ingest = ingest_recent(pool, cfg).await?;
    let alerts_fired = run_detection(pool).await?;
    let forwarded = forward_all_integrations(pool, controller_id).await?;
    Ok(CycleStats {
        ingest,
        alerts_fired,
        forwarded,
    })
}
