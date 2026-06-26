// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::State;
use axum::Extension;
use axum::Json;
use serde::Serialize;

use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ProjectRow {
    pub name: String,
    pub vm_count: i64,
}

pub async fn list_projects(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<ProjectRow>>, ApiError> {
    require_operator(&actor)?;
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(NULLIF(project, ''), 'default') AS name, COUNT(*) AS vm_count
         FROM vms GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(name, vm_count)| ProjectRow { name, vm_count })
            .collect(),
    ))
}
