// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::engine::enterprise_security::{
    self, CreateAirGapBundleRequest, RegisterVaultProviderRequest, UpsertMfaPolicyRequest,
    UpsertTenantPolicyRequest,
};
use crate::state::AppState;

pub async fn overview(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<enterprise_security::EnterpriseSecurityOverview>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::overview(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn list_vault_providers(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<enterprise_security::VaultProviderRow>>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::list_vault_providers(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn register_vault_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<RegisterVaultProviderRequest>,
) -> Result<Json<enterprise_security::VaultProviderRow>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::register_vault_provider(&state.pool, &body)
        .await
        .map(Json)
        .map_err(|e| ApiError::bad_request(e.to_string()))
}

pub async fn list_mfa_policies(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<enterprise_security::MfaPolicyRow>>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::list_mfa_policies(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn upsert_mfa_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(role): Path<String>,
    Json(body): Json<UpsertMfaPolicyRequest>,
) -> Result<Json<enterprise_security::MfaPolicyRow>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::upsert_mfa_policy(&state.pool, &role, &body)
        .await
        .map(Json)
        .map_err(|e| ApiError::bad_request(e.to_string()))
}

pub async fn list_air_gap_bundles(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<enterprise_security::AirGapBundleRow>>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::list_air_gap_bundles(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn create_air_gap_bundle(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateAirGapBundleRequest>,
) -> Result<Json<enterprise_security::AirGapBundleRow>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::create_air_gap_bundle(&state.pool, &body)
        .await
        .map(Json)
        .map_err(|e| ApiError::bad_request(e.to_string()))
}

pub async fn get_air_gap_bundle(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<enterprise_security::AirGapBundleRow>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::get_air_gap_bundle(&state.pool, id)
        .await
        .map(Json)
        .map_err(|e| ApiError::not_found(e.to_string()))
}

pub async fn sync_vault_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<enterprise_security::VaultSyncResult>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::sync_vault_provider(&state.pool, id)
        .await
        .map(Json)
        .map_err(|e| ApiError::bad_request(e.to_string()))
}

pub async fn sync_all_vault_providers(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<enterprise_security::VaultSyncAllResult>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::sync_all_vault_providers(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn mfa_compliance(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<enterprise_security::MfaComplianceReport>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::mfa_compliance(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn fips_matrix(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<enterprise_security::FipsMatrix>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::fips_matrix(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn tenant_isolation_overview(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<enterprise_security::TenantIsolationOverview>, ApiError> {
    require_operator(&actor)?;
    enterprise_security::tenant_isolation_overview(&state.pool)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn upsert_tenant_policy(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(project): Path<String>,
    Json(body): Json<UpsertTenantPolicyRequest>,
) -> Result<Json<enterprise_security::TenantIsolationItem>, ApiError> {
    require_admin(&actor)?;
    enterprise_security::upsert_tenant_policy(&state.pool, &project, &body)
        .await
        .map(Json)
        .map_err(|e| ApiError::bad_request(e.to_string()))
}
