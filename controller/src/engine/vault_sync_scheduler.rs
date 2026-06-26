// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Periodic Vault provider health sync (Phase 32).

use crate::state::AppState;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1800));
        loop {
            interval.tick().await;
            if let Err(e) =
                crate::engine::enterprise_security::sync_all_vault_providers(&state.pool).await
            {
                tracing::warn!("vault sync scheduler: {e:#}");
            }
        }
    });
}
