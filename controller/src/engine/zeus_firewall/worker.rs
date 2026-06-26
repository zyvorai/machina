// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use crate::state::AppState;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            if let Err(e) =
                crate::engine::zeus_firewall::temporary::expire_temporary_rules(&state.pool).await
            {
                tracing::warn!("firewall temporary rule expiry: {e:#}");
            }
            if let Err(e) =
                crate::engine::zeus_firewall::policy_operator::expire_stale_approvals(&state.pool)
                    .await
            {
                tracing::warn!("firewall approval SLA expiry: {e:#}");
            }
            if let Err(e) =
                crate::engine::zeus_firewall::policy_operator::reconcile_gitops_policies(
                    &state.pool,
                )
                .await
            {
                tracing::warn!("firewall GitOps reconcile: {e:#}");
            }
        }
    });
}
