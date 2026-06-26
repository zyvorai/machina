// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Vault/MFA inventory and air-gap bundle stubs (Horizon phase 28).

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct VaultProviderRow {
    pub id: Uuid,
    pub name: String,
    pub provider_type: String,
    pub address: String,
    pub namespace: String,
    pub status: String,
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MfaPolicyRow {
    pub id: Uuid,
    pub role_name: String,
    pub method: String,
    pub required: bool,
    pub grace_days: i32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AirGapBundleRow {
    pub id: Uuid,
    pub name: String,
    pub checksum: String,
    pub manifest_json: serde_json::Value,
    pub size_bytes: i64,
    pub exported_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnterpriseSecurityOverview {
    pub vault_providers: usize,
    pub vault_connected: usize,
    pub mfa_policies: usize,
    pub mfa_required_roles: usize,
    pub air_gap_bundles: usize,
    pub mfa_enrolled_users: usize,
    pub tenant_policies: usize,
    pub fips_profiles: usize,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterVaultProviderRequest {
    pub name: String,
    pub provider_type: Option<String>,
    pub address: Option<String>,
    pub namespace: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertMfaPolicyRequest {
    pub method: String,
    pub required: bool,
    pub grace_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAirGapBundleRequest {
    pub name: String,
}

pub async fn overview(pool: &SqlitePool) -> anyhow::Result<EnterpriseSecurityOverview> {
    let vault_providers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_providers")
        .fetch_one(pool)
        .await?;
    let vault_connected: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vault_providers WHERE status = 'active'")
            .fetch_one(pool)
            .await?;
    let mfa_policies: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mfa_policies")
        .fetch_one(pool)
        .await?;
    let mfa_required_roles: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM mfa_policies WHERE required = true")
            .fetch_one(pool)
            .await?;
    let air_gap_bundles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM air_gap_bundles")
        .fetch_one(pool)
        .await?;
    let mfa_enrolled_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mfa_enrollments")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let tenant_policies: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenant_isolation_policies")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let fips_profiles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fips_crypto_profiles")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let summary = format!(
        "{} vault · {} MFA enrolled · {} tenant policies · {} FIPS profile(s)",
        vault_connected, mfa_enrolled_users, tenant_policies, fips_profiles
    );

    Ok(EnterpriseSecurityOverview {
        vault_providers: vault_providers as usize,
        vault_connected: vault_connected as usize,
        mfa_policies: mfa_policies as usize,
        mfa_required_roles: mfa_required_roles as usize,
        air_gap_bundles: air_gap_bundles as usize,
        mfa_enrolled_users: mfa_enrolled_users as usize,
        tenant_policies: tenant_policies as usize,
        fips_profiles: fips_profiles as usize,
        summary,
    })
}

pub async fn list_vault_providers(pool: &SqlitePool) -> anyhow::Result<Vec<VaultProviderRow>> {
    sqlx::query_as(
        "SELECT id, name, provider_type, address, namespace, status,
                strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at) AS last_sync_at
         FROM vault_providers ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn register_vault_provider(
    pool: &SqlitePool,
    req: &RegisterVaultProviderRequest,
) -> anyhow::Result<VaultProviderRow> {
    let name = req.name.trim();
    if name.is_empty() {
        anyhow::bail!("name required");
    }
    let provider_type = req
        .provider_type
        .clone()
        .unwrap_or_else(|| "hashicorp".into());
    let address = req.address.clone().unwrap_or_default();
    let namespace = req.namespace.clone().unwrap_or_else(|| "machina".into());
    let status = if provider_type == "file" {
        "active"
    } else {
        "disconnected"
    };

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO vault_providers (id, name, provider_type, address, namespace, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           provider_type = EXCLUDED.provider_type,
           address = EXCLUDED.address,
           namespace = EXCLUDED.namespace,
           status = EXCLUDED.status",
    )
    .bind(id)
    .bind(name)
    .bind(&provider_type)
    .bind(&address)
    .bind(&namespace)
    .bind(status)
    .execute(pool)
    .await?;

    sqlx::query_as(
        "SELECT id, name, provider_type, address, namespace, status,
                strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at) AS last_sync_at
         FROM vault_providers WHERE name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn list_mfa_policies(pool: &SqlitePool) -> anyhow::Result<Vec<MfaPolicyRow>> {
    sqlx::query_as(
        "SELECT id, role_name, method, required, grace_days FROM mfa_policies ORDER BY role_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn upsert_mfa_policy(
    pool: &SqlitePool,
    role_name: &str,
    req: &UpsertMfaPolicyRequest,
) -> anyhow::Result<MfaPolicyRow> {
    let role = role_name.trim();
    if role.is_empty() {
        anyhow::bail!("role required");
    }
    let method = if req.method == "totp" || req.method == "webauthn" {
        req.method.clone()
    } else {
        "webauthn".into()
    };
    let grace = req.grace_days.unwrap_or(7).clamp(0, 90);

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO mfa_policies (id, role_name, method, required, grace_days)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (role_name) DO UPDATE SET
           method = EXCLUDED.method,
           required = EXCLUDED.required,
           grace_days = EXCLUDED.grace_days",
    )
    .bind(id)
    .bind(role)
    .bind(&method)
    .bind(req.required)
    .bind(grace)
    .execute(pool)
    .await?;

    sqlx::query_as(
        "SELECT id, role_name, method, required, grace_days FROM mfa_policies WHERE role_name = ?",
    )
    .bind(role)
    .fetch_one(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn list_air_gap_bundles(pool: &SqlitePool) -> anyhow::Result<Vec<AirGapBundleRow>> {
    sqlx::query_as(
        "SELECT id, name, checksum, manifest_json, size_bytes,
                strftime('%Y-%m-%dT%H:%M:%SZ', exported_at) AS exported_at
         FROM air_gap_bundles ORDER BY exported_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn create_air_gap_bundle(
    pool: &SqlitePool,
    req: &CreateAirGapBundleRequest,
) -> anyhow::Result<AirGapBundleRow> {
    let name = req.name.trim();
    if name.is_empty() {
        anyhow::bail!("name required");
    }

    let hosts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let vms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let templates: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM templates")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let pools: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM storage_pools")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let manifest = serde_json::json!({
        "bundle": name,
        "version": "1.0.0",
        "kind": "machina-air-gap-inventory",
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "inventory": {
            "hosts": hosts,
            "vms": vms,
            "templates": templates,
            "storage_pools": pools,
        },
        "includes": ["cluster-settings.yaml", "templates/", "policies/", "certificates/"],
        "note": "Simulated export manifest — no live Vault or bundle runner on main."
    });

    let manifest_str = manifest.to_string();
    let size_bytes = manifest_str.len() as i64;
    let checksum = format!("sha256:{:x}", simple_checksum(&manifest_str));
    let id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO air_gap_bundles (id, name, checksum, manifest_json, size_bytes)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(&checksum)
    .bind(&manifest)
    .bind(size_bytes)
    .execute(pool)
    .await?;

    sqlx::query_as(
        "SELECT id, name, checksum, manifest_json, size_bytes,
                strftime('%Y-%m-%dT%H:%M:%SZ', exported_at) AS exported_at
         FROM air_gap_bundles WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn get_air_gap_bundle(pool: &SqlitePool, id: Uuid) -> anyhow::Result<AirGapBundleRow> {
    sqlx::query_as(
        "SELECT id, name, checksum, manifest_json, size_bytes,
                strftime('%Y-%m-%dT%H:%M:%SZ', exported_at) AS exported_at
         FROM air_gap_bundles WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("bundle not found"))
}

fn simple_checksum(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultSyncResult {
    pub provider_id: Uuid,
    pub provider_name: String,
    pub status: String,
    pub message: String,
    pub last_sync_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultSyncAllResult {
    pub synced: usize,
    pub results: Vec<VaultSyncResult>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MfaComplianceUser {
    pub username: String,
    pub role: String,
    pub required_method: String,
    pub enrolled: bool,
    pub compliant: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MfaComplianceReport {
    pub required_roles: usize,
    pub compliant_users: usize,
    pub non_compliant_users: usize,
    pub users: Vec<MfaComplianceUser>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FipsCryptoProfileRow {
    pub id: Uuid,
    pub name: String,
    pub tls_min_version: String,
    pub fips_mode: String,
    pub cipher_suites: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FipsMatrix {
    pub active_profile: String,
    pub openssl_version: String,
    pub profiles: Vec<FipsCryptoProfileRow>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TenantIsolationItem {
    pub project_name: String,
    pub vm_count: i64,
    pub network_isolation: String,
    pub max_vms: i32,
    pub max_storage_gib: i32,
    pub enforce_quotas: bool,
    pub quota_status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TenantIsolationOverview {
    pub projects: Vec<TenantIsolationItem>,
    pub enforced_count: usize,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertTenantPolicyRequest {
    pub network_isolation: Option<String>,
    pub max_vms: Option<i32>,
    pub max_storage_gib: Option<i32>,
    pub enforce_quotas: Option<bool>,
}

pub async fn sync_vault_provider(pool: &SqlitePool, id: Uuid) -> anyhow::Result<VaultSyncResult> {
    let row: VaultProviderRow = sqlx::query_as(
        "SELECT id, name, provider_type, address, namespace, status,
                strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at) AS last_sync_at
         FROM vault_providers WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("vault provider not found"))?;

    let (status, message) = probe_vault(&row);

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE vault_providers SET status = ?, last_sync_at = datetime('now') WHERE id = ?")
        .bind(&status)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO vault_sync_runs (id, provider_id, status, message) VALUES (?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind(&status)
    .bind(&message)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(VaultSyncResult {
        provider_id: id,
        provider_name: row.name,
        status,
        message,
        last_sync_at: chrono::Utc::now(),
    })
}

pub async fn sync_all_vault_providers(pool: &SqlitePool) -> anyhow::Result<VaultSyncAllResult> {
    let rows: Vec<VaultProviderRow> = sqlx::query_as(
        "SELECT id, name, provider_type, address, namespace, status,
                strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at) AS last_sync_at
         FROM vault_providers ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    let mut results = Vec::new();
    for row in rows {
        let (status, message) = probe_vault(&row);
        let mut tx = match pool.begin().await {
            Ok(t) => t,
            Err(_) => continue,
        };
        let ok = sqlx::query(
            "UPDATE vault_providers SET status = ?, last_sync_at = datetime('now') WHERE id = ?",
        )
        .bind(&status)
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .is_ok()
            && sqlx::query(
                "INSERT INTO vault_sync_runs (id, provider_id, status, message) VALUES (?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(row.id)
            .bind(&status)
            .bind(&message)
            .execute(&mut *tx)
            .await
            .is_ok()
            && tx.commit().await.is_ok();
        if ok {
            results.push(VaultSyncResult {
                provider_id: row.id,
                provider_name: row.name,
                status,
                message,
                last_sync_at: chrono::Utc::now(),
            });
        }
    }
    let synced = results.len();
    let active = results.iter().filter(|r| r.status == "active").count();
    Ok(VaultSyncAllResult {
        synced,
        summary: format!("Synced {synced} provider(s) · {active} active"),
        results,
    })
}

fn probe_vault(row: &VaultProviderRow) -> (String, String) {
    if row.provider_type == "file" {
        return (
            "active".into(),
            "Local file backend — secrets from controller config".into(),
        );
    }
    if row.address.is_empty() {
        return ("disconnected".into(), "No Vault address configured".into());
    }
    if row.address.contains("example") {
        return (
            "disconnected".into(),
            "Simulated HashiCorp Vault — replace address for live probe".into(),
        );
    }
    (
        "active".into(),
        format!("Vault health OK at {} (simulated probe)", row.address),
    )
}

pub async fn mfa_compliance(pool: &SqlitePool) -> anyhow::Result<MfaComplianceReport> {
    let policies = list_mfa_policies(pool).await?;
    let required: Vec<_> = policies.into_iter().filter(|p| p.required).collect();
    let users: Vec<(String, String)> =
        sqlx::query_as("SELECT username, role FROM users ORDER BY username")
            .fetch_all(pool)
            .await?;
    let enrolled: Vec<String> = sqlx::query_scalar("SELECT username FROM mfa_enrollments")
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let mut rows = Vec::new();
    for (username, role) in users {
        let policy = required.iter().find(|p| p.role_name == role);
        let Some(policy) = policy else {
            continue;
        };
        let is_enrolled = enrolled.iter().any(|u| u == &username);
        rows.push(MfaComplianceUser {
            username: username.clone(),
            role: role.clone(),
            required_method: policy.method.clone(),
            enrolled: is_enrolled,
            compliant: is_enrolled,
        });
    }

    let compliant_users = rows.iter().filter(|u| u.compliant).count();
    let non_compliant_users = rows.len().saturating_sub(compliant_users);
    Ok(MfaComplianceReport {
        required_roles: required.len(),
        compliant_users,
        non_compliant_users,
        summary: format!("{compliant_users} compliant · {non_compliant_users} need enrollment"),
        users: rows,
    })
}

pub async fn fips_matrix(pool: &SqlitePool) -> anyhow::Result<FipsMatrix> {
    let profiles: Vec<FipsCryptoProfileRow> = sqlx::query_as(
        "SELECT id, name, tls_min_version, fips_mode, cipher_suites, notes FROM fips_crypto_profiles ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    let active_profile = profiles
        .first()
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "platform-default".into());
    let openssl_version = std::process::Command::new("openssl")
        .arg("version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "openssl unavailable".into());
    let fips_active = profiles.iter().any(|p| p.fips_mode == "required");
    Ok(FipsMatrix {
        active_profile: active_profile.clone(),
        openssl_version,
        summary: format!(
            "Active profile {active_profile} · FIPS required: {}",
            if fips_active { "yes" } else { "no" }
        ),
        profiles,
    })
}

pub async fn tenant_isolation_overview(pool: &SqlitePool) -> anyhow::Result<TenantIsolationOverview> {
    let vm_counts: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(NULLIF(project, ''), 'default') AS name, COUNT(*)
         FROM vms GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(pool)
    .await?;
    let policies: Vec<(String, String, i32, i32, bool)> = sqlx::query_as(
        "SELECT project_name, network_isolation, max_vms, max_storage_gib, enforce_quotas
         FROM tenant_isolation_policies ORDER BY project_name",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut projects = Vec::new();
    for (name, vm_count) in vm_counts {
        let pol = policies.iter().find(|p| p.0 == name);
        let (network_isolation, max_vms, max_storage_gib, enforce_quotas) = pol
            .map(|p| (p.1.clone(), p.2, p.3, p.4))
            .unwrap_or(("shared".into(), 0, 0, false));
        let quota_status = if !enforce_quotas {
            "not enforced".into()
        } else if max_vms > 0 && vm_count > max_vms as i64 {
            "vm quota exceeded".into()
        } else {
            "within quota".into()
        };
        projects.push(TenantIsolationItem {
            project_name: name,
            vm_count,
            network_isolation,
            max_vms,
            max_storage_gib,
            enforce_quotas,
            quota_status,
        });
    }

    let enforced_count = projects.iter().filter(|p| p.enforce_quotas).count();
    Ok(TenantIsolationOverview {
        summary: format!(
            "{} workspace(s) · {} with enforced quotas",
            projects.len(),
            enforced_count
        ),
        enforced_count,
        projects,
    })
}

pub async fn upsert_tenant_policy(
    pool: &SqlitePool,
    project_name: &str,
    req: &UpsertTenantPolicyRequest,
) -> anyhow::Result<TenantIsolationItem> {
    let name = project_name.trim();
    if name.is_empty() {
        anyhow::bail!("project name required");
    }
    let network_isolation = req
        .network_isolation
        .clone()
        .unwrap_or_else(|| "shared".into());
    let max_vms = req.max_vms.unwrap_or(0).max(0);
    let max_storage_gib = req.max_storage_gib.unwrap_or(0).max(0);
    let enforce = req.enforce_quotas.unwrap_or(false);

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO tenant_isolation_policies (id, project_name, network_isolation, max_vms, max_storage_gib, enforce_quotas, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (project_name) DO UPDATE SET
           network_isolation = EXCLUDED.network_isolation,
           max_vms = EXCLUDED.max_vms,
           max_storage_gib = EXCLUDED.max_storage_gib,
           enforce_quotas = EXCLUDED.enforce_quotas,
           updated_at = datetime('now')",
    )
    .bind(id)
    .bind(name)
    .bind(&network_isolation)
    .bind(max_vms)
    .bind(max_storage_gib)
    .bind(enforce)
    .execute(pool)
    .await?;

    let ov = tenant_isolation_overview(pool).await?;
    ov.projects
        .into_iter()
        .find(|p| p.project_name == name)
        .ok_or_else(|| anyhow::anyhow!("policy not found after upsert"))
}
