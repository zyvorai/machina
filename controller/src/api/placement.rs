// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::State;
use axum::Extension;
use axum::Json;

use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::engine::placement::{
    compute_recommendations, persist_recommendations, PlacementRecommendationRow,
};
use crate::state::AppState;

pub async fn list_recommendations(
    State(state): State<AppState>,
) -> Result<Json<Vec<PlacementRecommendationRow>>, ApiError> {
    let rows = compute_recommendations(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let _ = persist_recommendations(&state.pool, &rows).await;
    Ok(Json(rows))
}

pub async fn refresh_recommendations(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<PlacementRecommendationRow>>, ApiError> {
    require_operator(&actor)?;
    list_recommendations(State(state)).await
}
