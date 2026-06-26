// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Extension;

use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;

pub async fn prometheus_metrics(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<impl IntoResponse, crate::api::ApiError> {
    require_operator(&actor)?;
    let hosts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let vms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let running: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vms WHERE observed_state = 'running'")
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0);
    let tasks_pending: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE status = 'pending'")
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0);
    let offline: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE state = 'offline'")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    #[derive(sqlx::FromRow)]
    struct VmMetricRow {
        vm_id: uuid::Uuid,
        name: String,
        cpu_percent: f32,
        memory_used_mib: i64,
    }
    let vm_rows: Vec<VmMetricRow> = sqlx::query_as(
        "SELECT m.vm_id, v.name, m.cpu_percent, m.memory_used_mib
         FROM vm_metrics m JOIN vms v ON v.id = m.vm_id",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let mut body = format!(
        "# HELP machina_platform_hosts Total registered hosts\n\
         # TYPE machina_platform_hosts gauge\n\
         machina_platform_hosts {hosts}\n\
         # HELP machina_platform_vms Total VMs\n\
         # TYPE machina_platform_vms gauge\n\
         machina_platform_vms {vms}\n\
         # HELP machina_platform_vms_running Running VMs\n\
         # TYPE machina_platform_vms_running gauge\n\
         machina_platform_vms_running {running}\n\
         # HELP machina_platform_tasks_pending Pending tasks\n\
         # TYPE machina_platform_tasks_pending gauge\n\
         machina_platform_tasks_pending {tasks_pending}\n\
         # HELP machina_platform_hosts_offline Offline hosts\n\
         # TYPE machina_platform_hosts_offline gauge\n\
         machina_platform_hosts_offline {offline}\n"
    );
    for row in vm_rows {
        let name = row.name.replace('"', "\\\"");
        body.push_str(&format!(
            "# HELP machina_vm_memory_used_mib VM memory used (MiB)\n\
             # TYPE machina_vm_memory_used_mib gauge\n\
             machina_vm_memory_used_mib{{vm=\"{name}\",vm_id=\"{}\"}} {}\n\
             # HELP machina_vm_cpu_percent VM CPU percent (0 when unavailable)\n\
             # TYPE machina_vm_cpu_percent gauge\n\
             machina_vm_cpu_percent{{vm=\"{name}\",vm_id=\"{}\"}} {}\n",
            row.vm_id, row.memory_used_mib, row.vm_id, row.cpu_percent,
        ));
    }
    body.push_str(&crate::engine::observability::prometheus_slo_gauges(&state.pool).await);
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        body,
    ))
}
