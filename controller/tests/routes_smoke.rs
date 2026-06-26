// Integration smoke test: fresh SQLite DB → migrate → bootstrap → hit every GET route.
// Run with: cargo test -p machina-controller --test routes_smoke

use std::sync::Arc;

use axum::body::Body;
use http::{Request, StatusCode};
use machina_controller::{
    api,
    config::ControllerConfig,
    db,
    leader,
    state::AppState,
    tasks::{bus::InMemoryTaskBus, TaskBus},
};
use tower::ServiceExt;

async fn build_app() -> axum::Router {
    // Disable JWT auth so routes respond without a token.
    std::env::set_var("MACHINA_SKIP_AUTH", "1");

    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    db::migrate(&pool).await.expect("migrate failed");
    db::ensure_bootstrap(&pool, "admin", "admin")
        .await
        .expect("bootstrap failed");

    let config = Arc::new(ControllerConfig::default());
    let (task_bus, _rx) = InMemoryTaskBus::new();
    let task_bus = task_bus as Arc<dyn TaskBus>;
    let leader = leader::spawn(pool.clone(), "test-controller".into());
    let state = AppState::new(pool, config, task_bus, leader);
    api::router(state)
}

async fn get(app: &axum::Router, path: &str) -> StatusCode {
    let req = Request::builder()
        .uri(path)
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req).await.unwrap().status()
}

async fn post(app: &axum::Router, path: &str, body: &str) -> StatusCode {
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    app.clone().oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn migrate_creates_all_tables() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    db::migrate(&pool).await.expect("migrate must succeed");

    let tables = [
        "clusters", "users", "hosts", "vms", "tasks", "events",
        "firewall_sites", "firewall_site_policies",
        "soc_detection_rules", "soc_alerts", "slo_policies",
        "ai_providers", "ai_prompts", "ai_actions", "ai_memory",
        "storage_pools", "networks", "network_segments",
        "vault_providers", "mfa_policies",
    ];
    for table in tables {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("table '{table}' missing or unreadable: {e}"));
        let _ = count;
    }
}

#[tokio::test]
async fn bootstrap_creates_default_rows() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    db::migrate(&pool).await.unwrap();
    db::ensure_bootstrap(&pool, "admin", "s3cret").await.unwrap();

    let clusters: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clusters")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(clusters, 1, "should have exactly 1 default cluster");

    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(users, 1, "should have exactly 1 admin user");

    let hosts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(hosts, 1, "should have exactly 1 default localhost host");

    // Verify UUID PKs are 16-byte BLOBs, not text strings.
    let bad_ids: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM clusters WHERE length(id) != 16",
    )
    .fetch_one(&pool).await.unwrap();
    assert_eq!(bad_ids, 0, "cluster id must be a 16-byte UUID blob");
}

#[tokio::test]
async fn smoke_get_routes() {
    let app = build_app().await;

    let routes = [
        "/api/v1/health",
        "/api/v1/hosts",
        "/api/v1/vms",
        "/api/v1/tasks",
        "/api/v1/cluster",
        "/api/v1/ai/agents",
        "/api/v1/ai/actions/hub",
        "/api/v1/ai/prompts",
        "/api/v1/ai/providers",
        "/api/v1/ai/memory/incidents",
        "/api/v1/ai/memory/settings",
        "/api/v1/ai/fleet/summary",
        "/api/v1/zeus-firewall/overview",
        "/api/v1/zeus-firewall/operator/plan",
        "/api/v1/zeus-firewall/multisite/overview",
        "/api/v1/zeus-firewall/multisite/dr-templates",
        "/api/v1/soc/rules",
        "/api/v1/observability/traces",
        "/api/v1/observability/overview",
        "/api/v1/enterprise/vault/providers",
        "/api/v1/enterprise/mfa/policies",
        "/api/v1/enterprise/fips/matrix",
        "/api/v1/enterprise/tenants/overview",
        "/api/v1/fleet/desktop",
        "/api/v1/fleet/activity",
        "/api/v1/fleet/storage",
        "/api/v1/marketplace/plugins",
        "/api/v1/operations/runbooks",
        "/api/v1/network/segments/overview",
        "/api/v1/network/ipam/pools",
        "/api/v1/storage/pools",
    ];

    let mut failures = Vec::new();
    for path in routes {
        let status = get(&app, path).await;
        if !status.is_success() {
            failures.push(format!("{path} [{status}]"));
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} route(s) returned non-2xx:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}

#[tokio::test]
async fn smoke_post_routes() {
    let app = build_app().await;

    let routes: &[(&str, &str)] = &[
        ("/api/v1/ai/copilot/chat", r#"{"message":"hi"}"#),
    ];

    let mut failures = Vec::new();
    for (path, body) in routes {
        let status = post(&app, path, body).await;
        if !status.is_success() {
            failures.push(format!("{path} [{status}]"));
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} POST route(s) returned non-2xx:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
