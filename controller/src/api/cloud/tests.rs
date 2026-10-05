// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Extension,
};
use serde_json::{json, Value};
use tower::ServiceExt;

struct Fixture {
    state: AppState,
    project: Uuid,
    other: Uuid,
    host: Uuid,
    _rx: tokio::sync::mpsc::UnboundedReceiver<crate::tasks::TaskMessage>,
}
impl Fixture {
    async fn new() -> Self {
        let (state, rx) = crate::engine::test_support::test_state().await;
        let project = Uuid::new_v4();
        let other = Uuid::new_v4();
        let host = Uuid::new_v4();
        let cluster = Uuid::new_v4();
        sqlx::query("INSERT INTO clusters(id,name) VALUES (?,'cloud-test')")
            .bind(cluster)
            .execute(&state.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO hosts(id,cluster_id,hostname,state) VALUES (?,?,'cloud-host','online')",
        )
        .bind(host)
        .bind(cluster)
        .execute(&state.pool)
        .await
        .unwrap();
        for (id, name) in [(project, "cloud-a"), (other, "cloud-b")] {
            sqlx::query("INSERT INTO projects(id,name) VALUES (?,?)")
                .bind(id)
                .bind(name)
                .execute(&state.pool)
                .await
                .unwrap();
        }
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO users(id,username,password_hash,role) VALUES (?,'alice','unused','operator')").bind(user).execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO project_role_assignments(id,user_id,project_id,role) VALUES (?,?,?,'operator')").bind(Uuid::new_v4()).bind(user).bind(project).execute(&state.pool).await.unwrap();
        Self {
            state,
            project,
            other,
            host,
            _rx: rx,
        }
    }
    fn actor(name: &str, role: &str) -> AuthUser {
        AuthUser {
            username: name.into(),
            role: role.into(),
            auth_source: None,
        }
    }
    async fn call(
        &self,
        actor: AuthUser,
        method: &str,
        path: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let app = routes()
            .layer(Extension(actor))
            .with_state(self.state.clone());
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    async fn admin(&self, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        self.call(Self::actor("admin", "admin"), method, path, body)
            .await
    }
    async fn vpc(&self, cidr: &str) -> Uuid {
        let (status, row) = self
            .admin(
                "POST",
                &format!("/api/v1/cloud/projects/{}/vpcs", self.project),
                json!({"name":"private","cidr":cidr,"host_id":self.host}),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{row}");
        serde_json::from_value(row["id"].clone()).unwrap()
    }
    async fn subnet(&self, vpc: Uuid) -> Uuid {
        let (status, row) = self
            .admin(
                "POST",
                &format!("/api/v1/cloud/vpcs/{vpc}/subnets"),
                json!({"name":"apps","cidr":"10.20.1.0/24"}),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{row}");
        serde_json::from_value(row["id"].clone()).unwrap()
    }
}

#[tokio::test]
async fn cloud_access_is_always_scoped_and_unknown_keys_fail_closed() {
    let f = Fixture::new().await;
    let path = format!("/api/v1/cloud/projects/{}/vpcs", f.other);
    assert_eq!(
        f.call(Fixture::actor("alice", "operator"), "GET", &path, json!({}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.call(
            Fixture::actor("service-key", "operator"),
            "GET",
            &format!("/api/v1/cloud/projects/{}/vpcs", f.project),
            json!({})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let id = f.vpc("10.20.0.0/16").await;
    let body = json!({"name":"readonly","cidr":"10.20.2.0/24"});
    assert_eq!(
        f.call(
            Fixture::actor("alice", "viewer"),
            "POST",
            &format!("/api/v1/cloud/vpcs/{id}/subnets"),
            body
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.call(
            Fixture::actor("alice", "operator"),
            "GET",
            &format!("/api/v1/cloud/vpcs/{id}"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
}
#[tokio::test]
async fn overlapping_vpcs_and_subnets_are_rejected_and_outbox_is_committed() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    let path = format!("/api/v1/cloud/projects/{}/vpcs", f.other);
    assert_eq!(
        f.admin(
            "POST",
            &path,
            json!({"name":"collision","cidr":"10.20.0.0/16","host_id":f.host})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let path = format!("/api/v1/cloud/vpcs/{vpc}/subnets");
    assert_eq!(
        f.admin(
            "POST",
            &path,
            json!({"name":"collision","cidr":"10.20.1.128/25"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.admin(
            "POST",
            &path,
            json!({"name":"outside","cidr":"10.21.0.0/24"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let n:i64=sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE resource_id=? AND status='pending' AND operation='cloud.subnet.provision'").bind(subnet).fetch_one(&f.state.pool).await.unwrap();
    assert_eq!(n, 1);
    assert_eq!(
        f.admin("DELETE", &format!("/api/v1/cloud/vpcs/{vpc}"), json!({}))
            .await
            .0,
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn ipam_retries_reuse_addresses_and_never_enter_dhcp_range() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    let path = format!("/api/v1/cloud/subnets/{subnet}/addresses");
    let (_, a) = f.admin("POST", &path, json!({"request_key":"vm-a"})).await;
    assert_eq!(a["address"], "10.20.1.4");
    let (_, again) = f.admin("POST", &path, json!({"request_key":"vm-a"})).await;
    assert_eq!(again, a);
    let (_, b) = f.admin("POST", &path, json!({"request_key":"vm-b"})).await;
    assert_eq!(b["address"], "10.20.1.5");
    for n in 6..=127 {
        sqlx::query(
            "INSERT INTO cloud_ip_allocations(id,subnet_id,request_key,address) VALUES (?,?,?,?)",
        )
        .bind(Uuid::new_v4())
        .bind(subnet)
        .bind(format!("reserve-{n}"))
        .bind(format!("10.20.1.{n}"))
        .execute(&f.state.pool)
        .await
        .unwrap();
    }
    assert_eq!(
        f.admin("POST", &path, json!({"request_key":"overflow"}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.admin(
            "DELETE",
            &format!("{path}/{}", a["id"].as_str().unwrap()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        f.admin("POST", &path, json!({"request_key":"reused"}))
            .await
            .1["address"],
        "10.20.1.4"
    );
}
#[tokio::test]
async fn routes_and_peerings_never_claim_live_forwarding() {
    let f = Fixture::new().await;
    let a = f.vpc("10.20.0.0/16").await;
    let (_, b) = f
        .admin(
            "POST",
            &format!("/api/v1/cloud/projects/{}/vpcs", f.other),
            json!({"name":"remote","cidr":"10.21.0.0/16","host_id":f.host}),
        )
        .await;
    let b = b["id"].as_str().unwrap();
    let path = format!("/api/v1/cloud/vpcs/{a}/peerings");
    let (_, peer) = f.admin("POST", &path, json!({"accepter_id":b})).await;
    let pid = peer["id"].as_str().unwrap();
    let routes = format!("/api/v1/cloud/vpcs/{a}/routes");
    let body = json!({"destination":"10.21.0.0/16","target":"peering","target_id":pid});
    assert_eq!(
        f.admin("POST", &routes, body.clone()).await.0,
        StatusCode::BAD_REQUEST
    );
    let accept = format!("/api/v1/cloud/peerings/{pid}/accept");
    assert_eq!(
        f.call(
            Fixture::actor("alice", "operator"),
            "POST",
            &accept,
            json!({})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.admin("POST", &accept, json!({})).await.1["forwarding_active"],
        false
    );
    assert_eq!(f.admin("POST", &routes, body).await.0, StatusCode::OK);
    assert_eq!(
        f.admin(
            "POST",
            &routes,
            json!({"destination":"0.0.0.0/0","target":"nat"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, plan) = f
        .admin("GET", &format!("/api/v1/cloud/vpcs/{a}/plan"), json!({}))
        .await;
    assert_eq!(plan["forwarding_active"], false);
    assert_eq!(plan["peerings"][0]["status"], "planned");
}
fn template() -> Value {
    json!({"api_version":"virt.zyvor.dev/v1","kind":"VirtualMachine","metadata":{"name":"base"},"spec":{"cpu":{"sockets":1,"cores":1},"memory":"512Mi","storage":[{"name":"root","size":"1Gi","class":"local"}]}})
}
#[tokio::test]
async fn template_secrets_and_cross_project_groups_are_rejected() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    sqlx::query("UPDATE cloud_subnets SET status='ready' WHERE id=?")
        .bind(subnet)
        .execute(&f.state.pool)
        .await
        .unwrap();
    let path = format!("/api/v1/cloud/projects/{}/launch-templates", f.project);
    let mut secret = template();
    secret["spec"]["cloud_init"] = json!({"password":"private"});
    assert_eq!(
        f.admin("POST", &path, json!({"name":"secret","vm":secret}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, t) = f
        .admin("POST", &path, json!({"name":"base","vm":template()}))
        .await;
    assert_eq!(status, StatusCode::OK, "{t}");
    let policy = json!({"min":0,"max":3,"desired":1,"target_cpu":null,"cooldown_secs":300});
    let body = json!({"name":"apps","template_id":t["id"],"subnet_id":subnet,"policy":policy});
    assert_eq!(
        f.admin(
            "POST",
            &format!("/api/v1/cloud/projects/{}/instance-groups", f.other),
            body.clone()
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, g) = f
        .admin(
            "POST",
            &format!("/api/v1/cloud/projects/{}/instance-groups", f.project),
            body,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{g}");
    let (_, detail) = f
        .admin(
            "GET",
            &format!(
                "/api/v1/cloud/instance-groups/{}",
                g["id"].as_str().unwrap()
            ),
            json!({}),
        )
        .await;
    assert_eq!(detail["scale_in"], "stop-and-retain");
}

#[tokio::test]
async fn legacy_attachment_paths_check_owner_host_and_ready_state() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    let name = format!("mc-{subnet}");
    let admin = Fixture::actor("admin", "admin");
    assert!(
        authorize_attachment(&f.state, &admin, &name, "cloud-a", Some(f.host))
            .await
            .is_err()
    );
    sqlx::query("UPDATE cloud_subnets SET status='ready' WHERE id=?")
        .bind(subnet)
        .execute(&f.state.pool)
        .await
        .unwrap();
    assert!(
        authorize_attachment(&f.state, &admin, &name, "cloud-a", Some(f.host))
            .await
            .is_ok()
    );
    assert!(
        authorize_attachment(&f.state, &admin, &name, "cloud-b", Some(f.host))
            .await
            .is_err()
    );
    assert!(
        authorize_attachment(&f.state, &admin, &name, "cloud-a", Some(Uuid::new_v4()))
            .await
            .is_err()
    );
    let network: Uuid = sqlx::query_scalar("SELECT network_id FROM cloud_subnets WHERE id=?")
        .bind(subnet)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert!(protect_network(&f.state, network).await.is_err());
}
#[tokio::test]
async fn a_bus_outage_does_not_lose_the_committed_subnet_job() {
    let mut f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let (bus, rx) = crate::tasks::bus::InMemoryTaskBus::new();
    drop(rx);
    f.state.task_bus = bus;
    let subnet = f.subnet(vpc).await;
    let status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE resource_id=?")
        .bind(subnet)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(status, "pending");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cloud_subnets WHERE id=?")
        .bind(subnet)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn instance_reconciliation_is_idempotent_and_scale_in_retains_disks() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    sqlx::query("UPDATE cloud_subnets SET status='ready' WHERE id=?")
        .bind(subnet)
        .execute(&f.state.pool)
        .await
        .unwrap();
    let (status, t) = f
        .admin(
            "POST",
            &format!("/api/v1/cloud/projects/{}/launch-templates", f.project),
            json!({"name":"base","vm":template()}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{t}");
    let policy = json!({"min":0,"max":2,"desired":1,"target_cpu":null,"cooldown_secs":300});
    let (status, g) = f
        .admin(
            "POST",
            &format!("/api/v1/cloud/projects/{}/instance-groups", f.project),
            json!({"name":"apps","template_id":t["id"],"subnet_id":subnet,"policy":policy}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{g}");
    let group: Uuid = serde_json::from_value(g["id"].clone()).unwrap();
    crate::engine::cloud::reconcile_group(&f.state, group)
        .await
        .unwrap();
    crate::engine::cloud::reconcile_group(&f.state, group)
        .await
        .unwrap();
    let members: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cloud_group_members WHERE group_id=?")
            .bind(group)
            .fetch_one(&f.state.pool)
            .await
            .unwrap();
    assert_eq!(members, 1);
    let (vm,desired):(Uuid,String)=sqlx::query_as("SELECT v.id,v.desired_state FROM vms v JOIN cloud_group_members m ON m.vm_id=v.id WHERE m.group_id=?").bind(group).fetch_one(&f.state.pool).await.unwrap();
    assert_eq!(desired, "running");
    assert!(check_vm_host(&f.state.pool, vm, f.host).await.is_ok());
    assert!(check_vm_host(&f.state.pool, vm, Uuid::new_v4())
        .await
        .is_err());
    let policy = json!({"min":0,"max":2,"desired":0,"target_cpu":null,"cooldown_secs":300});
    assert_eq!(
        f.admin(
            "PATCH",
            &format!("/api/v1/cloud/instance-groups/{group}"),
            json!({"policy":policy,"paused":false})
        )
        .await
        .0,
        StatusCode::OK
    );
    crate::engine::cloud::reconcile_group(&f.state, group)
        .await
        .unwrap();
    let desired: String = sqlx::query_scalar("SELECT desired_state FROM vms WHERE id=?")
        .bind(vm)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(desired, "stopped");
    let disks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vm_disks WHERE vm_id=?")
        .bind(vm)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(disks, 1);
    let policy = json!({"min":0,"max":2,"desired":1,"target_cpu":null,"cooldown_secs":300});
    f.admin(
        "PATCH",
        &format!("/api/v1/cloud/instance-groups/{group}"),
        json!({"policy":policy,"paused":true}),
    )
    .await;
    crate::engine::cloud::reconcile_group(&f.state, group)
        .await
        .unwrap();
    let desired: String = sqlx::query_scalar("SELECT desired_state FROM vms WHERE id=?")
        .bind(vm)
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(desired, "stopped");
}

#[tokio::test]
async fn subnet_creation_rolls_back_if_the_outbox_insert_fails() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    sqlx::query("CREATE TRIGGER fail_cloud_job BEFORE INSERT ON tasks WHEN NEW.operation='cloud.subnet.provision' BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END").execute(&f.state.pool).await.unwrap();
    let (status, _) = f
        .admin(
            "POST",
            &format!("/api/v1/cloud/vpcs/{vpc}/subnets"),
            json!({"name":"apps","cidr":"10.20.1.0/24"}),
        )
        .await;
    assert!(status.is_server_error());
    // Acquiring the sole connection waits for SQLx's deferred rollback.
    let count:i64=sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM cloud_subnets)+(SELECT COUNT(*) FROM networks WHERE backend='cloud-isolated')").fetch_one(&f.state.pool).await.unwrap();
    assert_eq!(count, 0);
}
#[tokio::test]
async fn concurrent_ipam_requests_are_unique_and_repeated_keys_are_idempotent() {
    let f = Fixture::new().await;
    let vpc = f.vpc("10.20.0.0/16").await;
    let subnet = f.subnet(vpc).await;
    let path = format!("/api/v1/cloud/subnets/{subnet}/addresses");
    let (a, b) = tokio::join!(
        f.admin("POST", &path, json!({"request_key":"a"})),
        f.admin("POST", &path, json!({"request_key":"b"}))
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_ne!(a.1["address"], b.1["address"]);
    let (a, b) = tokio::join!(
        f.admin("POST", &path, json!({"request_key":"shared"})),
        f.admin("POST", &path, json!({"request_key":"shared"}))
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(a.1, b.1);
}
