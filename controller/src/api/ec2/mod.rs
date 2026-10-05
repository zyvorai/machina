// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! EC2-compatible Query API (`POST /ec2`), signed with AWS SigV4 so awscli / boto3 work with `--endpoint-url`.
//!
//! v1 actions: DescribeInstances, DescribeInstanceTypes, DescribeTags, DescribeKeyPairs, StartInstances,
//! StopInstances, RunInstances, TerminateInstances, CreateTags, DeleteTags. Everything else answers `UnsupportedOperation`. Access keys are managed under
//! `/api/v1/ec2/access-keys` (admin).

pub mod sigv4;

use std::collections::BTreeMap;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::Serialize;
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::resource_ids::{ec2_id, Kind};
use crate::state::AppState;

const XMLNS: &str = "http://ec2.amazonaws.com/doc/2016-11-15/";
const OWNER: &str = "000000000000";

// ---- errors ---------------------------------------------------------------

#[derive(Debug)]
pub struct Ec2Error {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl Ec2Error {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self { status, code, message: message.into() }
    }
    fn bad(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }
}

impl From<sqlx::Error> for Ec2Error {
    fn from(e: sqlx::Error) -> Self {
        tracing::warn!("ec2 api database error: {e}");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "InternalError", "internal error")
    }
}

impl From<ApiError> for Ec2Error {
    fn from(e: ApiError) -> Self {
        Self::new(e.status, "UnauthorizedOperation", e.message)
    }
}

pub(crate) fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn error_xml(e: &Ec2Error, request_id: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Errors><Error><Code>{}</Code><Message>{}</Message></Error></Errors><RequestID>{request_id}</RequestID></Response>",
        e.code,
        xml_escape(&e.message)
    )
}

fn xml_response(action: &str, request_id: &str, body: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><{action}Response xmlns=\"{XMLNS}\"><requestId>{request_id}</requestId>{body}</{action}Response>")
}

// ---- pure helpers ----------------------------------------------------------

/// libvirt-style `observed_state` → EC2 (code, name).
pub(crate) fn instance_state(observed: &str) -> (u16, &'static str) {
    match observed {
        "running" | "blocked" => (16, "running"),
        "shutoff" | "stopped" | "paused" | "suspended" | "pmsuspended" | "crashed" => (80, "stopped"),
        "shutdown" => (64, "stopping"),
        "terminated" => (48, "terminated"),
        _ => (0, "pending"),
    }
}

/// `Filter.N.Name` / `Filter.N.Value.M` → (name, values).
pub(crate) fn parse_filters(p: &BTreeMap<String, String>) -> Vec<(String, Vec<String>)> {
    let mut out = Vec::new();
    for n in 1..=50 {
        let Some(name) = p.get(&format!("Filter.{n}.Name")) else { break };
        let values: Vec<String> = (1..=50).map_while(|m| p.get(&format!("Filter.{n}.Value.{m}")).cloned()).collect();
        out.push((name.clone(), values));
    }
    out
}

/// `{prefix}.1`, `{prefix}.2`, … values.
pub(crate) fn indexed(p: &BTreeMap<String, String>, prefix: &str) -> Vec<String> {
    (1..=200).map_while(|n| p.get(&format!("{prefix}.{n}")).cloned()).collect()
}

pub(crate) fn parse_form(body: &str) -> BTreeMap<String, String> {
    url::form_urlencoded::parse(body.as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
}

struct Inst {
    id: Uuid,
    name: String,
    state: String,
    vcpus: i64,
    memory_mib: i64,
    flavor: Option<String>,
    ip: Option<String>,
    created: String,
    tags: Vec<(String, String)>,
}

impl Inst {
    fn eid(&self) -> String {
        ec2_id(Kind::Vm, self.id)
    }
    fn itype(&self) -> String {
        self.flavor.clone().unwrap_or_else(|| format!("custom.{}x{}", self.vcpus, self.memory_mib))
    }
}

fn matches_filter(i: &Inst, name: &str, values: &[String]) -> bool {
    let any = |v: &str| values.iter().any(|x| x == v);
    match name {
        "instance-id" => any(&i.eid()),
        "instance-state-name" => any(instance_state(&i.state).1),
        "instance-type" => any(&i.itype()),
        "private-ip-address" => i.ip.as_deref().is_some_and(any),
        "tag-key" => i.tags.iter().any(|(k, _)| any(k)),
        n if n.starts_with("tag:") => {
            let key = &n[4..];
            i.tags.iter().any(|(k, v)| k == key && any(v))
        }
        // Unknown filters match nothing rather than everything: a typo must not widen a destructive call.
        _ => false,
    }
}

/// One instance as an `<item>` of an `instancesSet`.
fn instance_core(i: &Inst) -> String {
    let (code, name) = instance_state(&i.state);
    let tags: String = i
        .tags
        .iter()
        .map(|(k, v)| format!("<item><key>{}</key><value>{}</value></item>", xml_escape(k), xml_escape(v)))
        .collect();
    let ip = i.ip.as_deref().map(|a| format!("<privateIpAddress>{}</privateIpAddress>", xml_escape(a))).unwrap_or_default();
    format!(
        "<item><instanceId>{}</instanceId><imageId/><instanceState><code>{code}</code><name>{name}</name></instanceState><privateDnsName>{}</privateDnsName>{ip}<instanceType>{}</instanceType><launchTime>{}</launchTime><tagSet>{tags}</tagSet></item>",
        i.eid(),
        xml_escape(&i.name),
        xml_escape(&i.itype()),
        xml_escape(&i.created),
    )
}

/// One instance as a one-instance reservation (DescribeInstances).
fn instance_item(i: &Inst) -> String {
    format!(
        "<item><reservationId>r-{}</reservationId><ownerId>{OWNER}</ownerId><groupSet/><instancesSet>{}</instancesSet></item>",
        &i.id.simple().to_string()[..17],
        instance_core(i)
    )
}

async fn load_instances(state: &AppState) -> Result<Vec<Inst>, Ec2Error> {
    type Row = (Uuid, String, String, i64, i64, Option<String>, Option<String>, String);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT v.id, v.name, v.observed_state, v.vcpus, v.memory_mib, f.name, v.guest_ip, v.created_at \
         FROM vms v LEFT JOIN flavors f ON f.id = v.flavor_id WHERE COALESCE(v.inventory_source, 'libvirt') != 'kubevirt' ORDER BY v.name",
    )
    .fetch_all(&state.pool)
    .await?;
    // Terminated instances stay visible for an hour; then the tombstone and its tags go.
    let _ = sqlx::query(
        "DELETE FROM resource_tags WHERE resource_type = 'vm' AND resource_id IN \
         (SELECT lower(hex(id)) FROM terminated_instances WHERE terminated_at < datetime('now', '-1 hour'))",
    )
    .execute(&state.pool)
    .await;
    let _ = sqlx::query("DELETE FROM terminated_instances WHERE terminated_at < datetime('now', '-1 hour')")
        .execute(&state.pool)
        .await;
    let gone: Vec<(Uuid, String, Option<String>, i64, i64, String)> = sqlx::query_as(
        "SELECT id, name, instance_type, vcpus, memory_mib, terminated_at FROM terminated_instances \
         WHERE id NOT IN (SELECT id FROM vms) ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await?;
    let tags: Vec<(String, String, String)> =
        sqlx::query_as("SELECT resource_id, key, value FROM resource_tags WHERE resource_type = 'vm'")
            .fetch_all(&state.pool)
            .await?;
    let mut out: Vec<Inst> = rows
        .into_iter()
        .map(|(id, name, state, vcpus, memory_mib, flavor, ip, created)| Inst {
            tags: tags.iter().filter(|(r, _, _)| *r == id.simple().to_string()).map(|(_, k, v)| (k.clone(), v.clone())).collect(),
            id,
            name,
            state,
            vcpus,
            memory_mib,
            flavor,
            ip,
            created,
        })
        .collect();
    out.extend(gone.into_iter().map(|(id, name, flavor, vcpus, memory_mib, at)| Inst {
        tags: tags.iter().filter(|(r, _, _)| *r == id.simple().to_string()).map(|(_, k, v)| (k.clone(), v.clone())).collect(),
        id,
        name,
        state: "terminated".into(),
        vcpus,
        memory_mib,
        flavor,
        ip: None,
        created: at,
    }));
    Ok(out)
}

// ---- actions ---------------------------------------------------------------

async fn describe_instances(state: &AppState, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    let wanted = indexed(p, "InstanceId");
    let filters = parse_filters(p);
    let all = load_instances(state).await?;
    for w in &wanted {
        if !all.iter().any(|i| &i.eid() == w) {
            return Err(Ec2Error::bad("InvalidInstanceID.NotFound", format!("The instance ID '{w}' does not exist")));
        }
    }
    let items: String = all
        .iter()
        .filter(|i| wanted.is_empty() || wanted.contains(&i.eid()))
        .filter(|i| filters.iter().all(|(n, v)| matches_filter(i, n, v)))
        .map(instance_item)
        .collect();
    Ok(format!("<reservationSet>{items}</reservationSet>"))
}

async fn describe_instance_types(state: &AppState, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    let wanted = indexed(p, "InstanceType");
    let rows: Vec<(String, i64, i64)> = sqlx::query_as("SELECT name, vcpus, memory_mib FROM flavors ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    let items: String = rows
        .iter()
        .filter(|(n, _, _)| wanted.is_empty() || wanted.contains(n))
        .map(|(n, v, m)| {
            format!(
                "<item><instanceType>{}</instanceType><vCpuInfo><defaultVCpus>{v}</defaultVCpus></vCpuInfo><memoryInfo><sizeInMiB>{m}</sizeInMiB></memoryInfo></item>",
                xml_escape(n)
            )
        })
        .collect();
    Ok(format!("<instanceTypeSet>{items}</instanceTypeSet>"))
}

async fn describe_tags(state: &AppState, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    let filters = parse_filters(p);
    let rows: Vec<(String, String, String, String)> =
        sqlx::query_as("SELECT resource_type, resource_id, key, value FROM resource_tags ORDER BY resource_type, resource_id, key")
            .fetch_all(&state.pool)
            .await?;
    let mut items = String::new();
    for (rt, rid, k, v) in rows {
        let ok = filters.iter().all(|(n, vals)| match n.as_str() {
            "key" => vals.contains(&k),
            "value" => vals.contains(&v),
            "resource-type" => vals.iter().any(|x| x == "instance") && rt == "vm",
            _ => false,
        });
        if !ok {
            continue;
        }
        let kind = Kind::from_type(&rt);
        let id = Uuid::parse_str(&rid).map(|u| u.simple().to_string()).unwrap_or(rid.clone());
        let ec2 = kind.map(|k| format!("{}-{}", k.prefix(), &id[..17.min(id.len())])).unwrap_or(id);
        let rtype = if rt == "vm" { "instance".to_string() } else { rt.replace('_', "-") };
        items.push_str(&format!(
            "<item><resourceId>{ec2}</resourceId><resourceType>{rtype}</resourceType><key>{}</key><value>{}</value></item>",
            xml_escape(&k),
            xml_escape(&v)
        ));
    }
    Ok(format!("<tagSet>{items}</tagSet>"))
}

async fn describe_key_pairs(state: &AppState, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    let wanted = indexed(p, "KeyName");
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as("SELECT id, name, fingerprint FROM keypairs ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    let items: String = rows
        .iter()
        .filter(|(_, n, _)| wanted.is_empty() || wanted.contains(n))
        .map(|(id, n, f)| {
            format!(
                "<item><keyPairId>{}</keyPairId><keyName>{}</keyName><keyFingerprint>{}</keyFingerprint></item>",
                ec2_id(Kind::KeyPair, *id),
                xml_escape(n),
                xml_escape(f)
            )
        })
        .collect();
    Ok(format!("<keySet>{items}</keySet>"))
}

async fn power(state: &AppState, actor: &AuthUser, p: &BTreeMap<String, String>, start: bool) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let ids = indexed(p, "InstanceId");
    if ids.is_empty() {
        return Err(Ec2Error::bad("MissingParameter", "The request must contain the parameter InstanceId"));
    }
    let all = load_instances(state).await?;
    let mut items = String::new();
    for want in &ids {
        let i = all
            .iter()
            .find(|i| &i.eid() == want)
            .ok_or_else(|| Ec2Error::bad("InvalidInstanceID.NotFound", format!("The instance ID '{want}' does not exist")))?;
        let (pc, pn) = instance_state(&i.state);
        if i.state == "terminated" {
            return Err(Ec2Error::bad("IncorrectInstanceState", format!("The instance '{want}' is terminated")));
        }
        let r = if start {
            crate::api::vms::start_vm(State(state.clone()), Extension(actor.clone()), Path(i.id)).await
        } else {
            crate::api::vms::stop_vm(State(state.clone()), Extension(actor.clone()), Path(i.id)).await
        };
        r?;
        let (nc, nn) = if start { (0, "pending") } else { (64, "stopping") };
        items.push_str(&format!(
            "<item><instanceId>{want}</instanceId><currentState><code>{nc}</code><name>{nn}</name></currentState><previousState><code>{pc}</code><name>{pn}</name></previousState></item>"
        ));
    }
    Ok(format!("<instancesSet>{items}</instancesSet>"))
}

/// `Tag.N.Key/Value` and `TagSpecification.N.Tag.M.Key/Value` (instance specs only) → tags.
pub(crate) fn parse_tags(p: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let mut add = |kp: String, vp: String| {
        if let Some(k) = p.get(&kp) {
            out.insert(k.clone(), p.get(&vp).cloned().unwrap_or_default());
        }
    };
    for n in 1..=50 {
        add(format!("Tag.{n}.Key"), format!("Tag.{n}.Value"));
    }
    for sidx in 1..=5 {
        let rt = p.get(&format!("TagSpecification.{sidx}.ResourceType")).map(String::as_str);
        if rt.is_some_and(|r| r != "instance") {
            continue;
        }
        for n in 1..=50 {
            add(format!("TagSpecification.{sidx}.Tag.{n}.Key"), format!("TagSpecification.{sidx}.Tag.{n}.Value"));
        }
    }
    out
}

/// `UserData` is base64 in the EC2 API.
pub(crate) fn decode_user_data(b64: &str) -> Result<String, String> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| "UserData must be base64".to_string())?;
    String::from_utf8(raw).map_err(|_| "UserData must be UTF-8 text".to_string())
}

async fn wait_for_vm(state: &AppState, name: &str) -> Option<Uuid> {
    for _ in 0..40 {
        if let Ok(Some(id)) = sqlx::query_scalar::<_, Uuid>("SELECT id FROM vms WHERE name = ?")
            .bind(name)
            .fetch_optional(&state.pool)
            .await
        {
            return Some(id);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    None
}

async fn run_instances(state: &AppState, actor: &AuthUser, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let need = |k: &str| p.get(k).cloned().ok_or_else(|| Ec2Error::bad("MissingParameter", format!("The request must contain the parameter {k}")));
    let image = need("ImageId")?;
    let max: u32 = need("MaxCount")?.parse().map_err(|_| Ec2Error::bad("InvalidParameterValue", "MaxCount must be a number"))?;
    let min: u32 = p.get("MinCount").map_or(Ok(max), |v| v.parse()).map_err(|_| Ec2Error::bad("InvalidParameterValue", "MinCount must be a number"))?;

    // ImageId: an ami- id, or an image (template) name.
    let template_ref: String = if let Some((Kind::Image, hex)) = crate::resource_ids::parse(&image) {
        let mut conn = state.pool.acquire().await?;
        match crate::resource_ids::resolve(&mut conn, Kind::Image, &hex).await? {
            crate::resource_ids::Lookup::Found(id) => sqlx::query_scalar("SELECT name FROM templates WHERE id = ?").bind(id).fetch_one(&mut *conn).await?,
            _ => return Err(Ec2Error::bad("InvalidAMIID.NotFound", format!("The image id '{image}' does not exist"))),
        }
    } else {
        image.clone()
    };
    let flavor: Option<Uuid> = match p.get("InstanceType") {
        Some(t) => Some(
            sqlx::query_scalar("SELECT id FROM flavors WHERE name = ?")
                .bind(t)
                .fetch_optional(&state.pool)
                .await?
                .ok_or_else(|| Ec2Error::bad("InvalidParameterValue", format!("Unknown instance type '{t}'")))?,
        ),
        None => None,
    };
    let tags = parse_tags(p);
    let name = tags.get("Name").cloned().unwrap_or_else(|| format!("ec2-{}", &Uuid::new_v4().simple().to_string()[..8]));
    let mut spec = serde_json::json!({ "template_ref": template_ref, "name": name, "count": max, "min_count": min });
    if let Some(f) = flavor {
        spec["flavor_id"] = serde_json::json!(f);
    }
    if let Some(k) = p.get("KeyName") {
        spec["key_name"] = serde_json::json!(k);
    }
    if let Some(u) = p.get("UserData") {
        spec["cloud_init_user_data"] = serde_json::json!(decode_user_data(u).map_err(|m| Ec2Error::bad("InvalidParameterValue", m))?);
    }
    let body: crate::api::vms::RunInstancesBody =
        serde_json::from_value(spec).map_err(|e| Ec2Error::bad("InvalidParameterValue", e.to_string()))?;
    let Json(done) = crate::api::vms::run_instances(State(state.clone()), Extension(actor.clone()), Json(body))
        .await
        .map_err(|e| Ec2Error::bad("InsufficientInstanceCapacity", e.message))?;
    let names: Vec<String> = done["instances"].as_array().into_iter().flatten().filter_map(|i| i["name"].as_str().map(String::from)).collect();

    let mut ids = Vec::new();
    for n in &names {
        if let Some(id) = wait_for_vm(state, n).await {
            if !tags.is_empty() {
                let mut tx = state.pool.begin().await?;
                let _ = crate::api::tags::put_tag_map(&mut tx, Kind::Vm, id, &tags).await?;
                tx.commit().await?;
            }
            ids.push(id);
        }
    }
    let all = load_instances(state).await?;
    let items: String = all.iter().filter(|i| ids.contains(&i.id)).map(instance_core).collect();
    Ok(format!(
        "<reservationId>r-{}</reservationId><ownerId>{OWNER}</ownerId><groupSet/><instancesSet>{items}</instancesSet>",
        &Uuid::new_v4().simple().to_string()[..17]
    ))
}

async fn terminate(state: &AppState, actor: &AuthUser, p: &BTreeMap<String, String>) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let ids = indexed(p, "InstanceId");
    if ids.is_empty() {
        return Err(Ec2Error::bad("MissingParameter", "The request must contain the parameter InstanceId"));
    }
    let all = load_instances(state).await?;
    let mut items = String::new();
    for want in &ids {
        let i = all
            .iter()
            .find(|i| &i.eid() == want)
            .ok_or_else(|| Ec2Error::bad("InvalidInstanceID.NotFound", format!("The instance ID '{want}' does not exist")))?;
        let (pc, pn) = instance_state(&i.state);
        if i.state == "terminated" {
            items.push_str(&format!("<item><instanceId>{want}</instanceId><currentState><code>48</code><name>terminated</name></currentState><previousState><code>48</code><name>terminated</name></previousState></item>"));
            continue;
        }
        // No `confirmed`: a cluster that requires approval for deletions keeps requiring it here.
        crate::api::vms::delete_vm(State(state.clone()), Extension(actor.clone()), Path(i.id), None).await?;
        items.push_str(&format!(
            "<item><instanceId>{want}</instanceId><currentState><code>32</code><name>shutting-down</name></currentState><previousState><code>{pc}</code><name>{pn}</name></previousState></item>"
        ));
    }
    Ok(format!("<instancesSet>{items}</instancesSet>"))
}

async fn tag_resources(state: &AppState, actor: &AuthUser, p: &BTreeMap<String, String>, delete: bool) -> Result<String, Ec2Error> {
    require_operator(actor)?;
    let resources = indexed(p, "ResourceId");
    if resources.is_empty() {
        return Err(Ec2Error::bad("MissingParameter", "The request must contain the parameter ResourceId"));
    }
    let tags = parse_tags(p);
    if tags.is_empty() {
        return Err(Ec2Error::bad("MissingParameter", "The request must contain the parameter Tag"));
    }
    if !delete {
        crate::api::tags::validate_tags(&tags).map_err(|m| Ec2Error::bad("InvalidParameterValue", m))?;
    }
    for r in &resources {
        let (kind, hex) = crate::resource_ids::parse(r).ok_or_else(|| Ec2Error::bad("InvalidID", format!("The id '{r}' is not valid")))?;
        let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
        let id = match crate::resource_ids::resolve(&mut tx, kind, &hex).await? {
            crate::resource_ids::Lookup::Found(id) => id,
            _ => return Err(Ec2Error::bad("InvalidResourceID.NotFound", format!("The resource '{r}' does not exist"))),
        };
        if delete {
            let keys: Vec<String> = tags.keys().cloned().collect();
            crate::api::tags::delete_tag_keys(&mut tx, kind, id, &keys).await?;
        } else if let crate::api::tags::PutOutcome::TooMany(n) = crate::api::tags::put_tag_map(&mut tx, kind, id, &tags).await? {
            return Err(Ec2Error::bad("TagLimitExceeded", format!("that would give the resource {n} tags")));
        }
        tx.commit().await?;
    }
    Ok("<return>true</return>".into())
}

// ---- the endpoint ----------------------------------------------------------

fn respond(status: StatusCode, xml: String) -> Response {
    (status, [("content-type", "text/xml;charset=UTF-8")], xml).into_response()
}

/// `POST /ec2` — form-encoded `Action=…`, SigV4-signed.
pub async fn query(State(state): State<AppState>, headers: HeaderMap, uri: Uri, body: Bytes) -> Response {
    let request_id = Uuid::new_v4().to_string();
    match handle(&state, &headers, &uri, &body, &request_id).await {
        Ok(xml) => respond(StatusCode::OK, xml),
        Err(e) => respond(e.status, error_xml(&e, &request_id)),
    }
}

async fn handle(state: &AppState, headers: &HeaderMap, uri: &Uri, body: &Bytes, request_id: &str) -> Result<String, Ec2Error> {
    let denied = |m: &str| Ec2Error::new(StatusCode::FORBIDDEN, "AuthFailure", m.to_string());
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| denied("missing Authorization header"))?;
    let auth = sigv4::parse_authorization(auth_header).map_err(|_| denied("malformed Authorization header"))?;
    if auth.service != "ec2" {
        return Err(denied("the credential scope must be for the ec2 service"));
    }
    let key: Option<(String, String, String, bool)> = sqlx::query_as(
        "SELECT secret_enc, username, role, revoked FROM ec2_access_keys WHERE access_key_id = ?",
    )
    .bind(&auth.access_key)
    .fetch_optional(&state.pool)
    .await?;
    // One message for unknown, revoked and wrong-secret keys: no oracle for valid access key ids.
    let Some((secret_enc, username, role, false)) = key else {
        return Err(denied("the security token included in the request is invalid"));
    };
    let secret = crate::engine::ai::crypto::load_api_key(&secret_enc)
        .map_err(|_| Ec2Error::new(StatusCode::INTERNAL_SERVER_ERROR, "InternalError", "access key cannot be read"))?;
    let hv: Vec<(String, String)> = headers
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    let amz_date = headers.get("x-amz-date").and_then(|v| v.to_str().ok()).unwrap_or_default();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    match sigv4::verify(&auth, &secret, "POST", uri.path(), uri.query().unwrap_or(""), &hv, body, amz_date, now) {
        Ok(()) => {}
        Err(sigv4::SigError::Skew) => {
            return Err(Ec2Error::new(StatusCode::FORBIDDEN, "RequestExpired", "the request timestamp is too far from the server time"))
        }
        Err(_) => return Err(denied("the request signature we calculated does not match the signature you provided")),
    }
    let _ = sqlx::query("UPDATE ec2_access_keys SET last_used_at = CURRENT_TIMESTAMP WHERE access_key_id = ?")
        .bind(&auth.access_key)
        .execute(&state.pool)
        .await;

    let actor = AuthUser { username, role, auth_source: Some("ec2-access-key".into()) };
    let params = parse_form(std::str::from_utf8(body).map_err(|_| Ec2Error::bad("MalformedQueryString", "body is not UTF-8"))?);
    let action = params.get("Action").map(String::as_str).unwrap_or_default();
    let inner = match action {
        "DescribeInstances" => describe_instances(state, &params).await?,
        "DescribeInstanceTypes" => describe_instance_types(state, &params).await?,
        "DescribeTags" => describe_tags(state, &params).await?,
        "DescribeKeyPairs" => describe_key_pairs(state, &params).await?,
        "StartInstances" => power(state, &actor, &params, true).await?,
        "StopInstances" => power(state, &actor, &params, false).await?,
        "RunInstances" => run_instances(state, &actor, &params).await?,
        "TerminateInstances" => terminate(state, &actor, &params).await?,
        "CreateTags" => tag_resources(state, &actor, &params, false).await?,
        "DeleteTags" => tag_resources(state, &actor, &params, true).await?,
        "" => return Err(Ec2Error::bad("MissingAction", "No action was specified")),
        other => {
            return Err(Ec2Error::bad("UnsupportedOperation", format!("The action {other} is not supported by this endpoint")))
        }
    };
    Ok(xml_response(action, request_id, &inner))
}

// ---- access key management (admin) -----------------------------------------

#[derive(Serialize)]
pub struct AccessKeyRow {
    access_key_id: String,
    username: String,
    role: String,
    description: String,
    created_at: String,
    last_used_at: Option<String>,
    revoked: bool,
}

fn random_string(n: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect()
}

#[derive(serde::Deserialize, Default)]
pub struct NewKey {
    #[serde(default)]
    pub description: String,
}

/// The secret is returned once and never again.
pub async fn create_access_key(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<NewKey>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    if body.description.len() > 200 {
        return Err(ApiError::bad_request("description is limited to 200 characters"));
    }
    let id = format!("MCAK{}", random_string(16).to_ascii_uppercase());
    let secret = random_string(40);
    let stored = crate::engine::ai::crypto::store_api_key(&secret).map_err(|e| ApiError::internal(e.to_string()))?;
    sqlx::query("INSERT INTO ec2_access_keys (access_key_id, secret_enc, username, role, description) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(stored)
        .bind(&actor.username)
        .bind(&actor.role)
        .bind(&body.description)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({
        "access_key_id": id,
        "secret_access_key": secret,
        "username": actor.username,
        "role": actor.role,
        "note": "store the secret now; it cannot be shown again",
    })))
}

pub async fn list_access_keys(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<AccessKeyRow>>, ApiError> {
    require_admin(&actor)?;
    let rows: Vec<(String, String, String, String, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT access_key_id, username, role, description, created_at, last_used_at, revoked FROM ec2_access_keys ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(access_key_id, username, role, description, created_at, last_used_at, revoked)| AccessKeyRow {
                access_key_id, username, role, description, created_at, last_used_at, revoked,
            })
            .collect(),
    ))
}

pub async fn revoke_access_key(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let r = sqlx::query("UPDATE ec2_access_keys SET revoked = 1 WHERE access_key_id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(ApiError::not_found("access key not found"));
    }
    Ok(Json(serde_json::json!({ "revoked": id })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn states_map_to_ec2_codes() {
        assert_eq!(instance_state("running"), (16, "running"));
        assert_eq!(instance_state("shutoff"), (80, "stopped"));
        assert_eq!(instance_state("weird"), (0, "pending"));
        assert_eq!(instance_state("terminated"), (48, "terminated"));
    }

    #[test]
    fn form_filters_and_indexed_params() {
        let m = parse_form("Action=DescribeInstances&InstanceId.1=i-a&InstanceId.2=i-b&Filter.1.Name=tag%3AEnv&Filter.1.Value.1=prod&Filter.1.Value.2=stage");
        assert_eq!(indexed(&m, "InstanceId"), ["i-a", "i-b"]);
        assert_eq!(parse_filters(&m), vec![("tag:Env".to_string(), vec!["prod".to_string(), "stage".to_string()])]);
        assert!(indexed(&p(&[]), "InstanceId").is_empty());
    }

    fn inst() -> Inst {
        Inst {
            id: Uuid::parse_str("0123456789abcdef0123456789abcdef").unwrap(),
            name: "web<1>".into(),
            state: "running".into(),
            vcpus: 2,
            memory_mib: 4096,
            flavor: None,
            ip: Some("10.0.0.5".into()),
            created: "2026-10-05 10:00:00".into(),
            tags: vec![("Env".into(), "prod".into())],
        }
    }

    #[test]
    fn filters_match_by_id_state_type_and_tag_and_unknown_matches_nothing() {
        let i = inst();
        assert!(matches_filter(&i, "instance-id", &[i.eid()]));
        assert!(matches_filter(&i, "instance-state-name", &["running".into()]));
        assert!(!matches_filter(&i, "instance-state-name", &["stopped".into()]));
        assert!(matches_filter(&i, "instance-type", &["custom.2x4096".into()]));
        assert!(matches_filter(&i, "tag:Env", &["prod".into()]));
        assert!(!matches_filter(&i, "tag:Env", &["dev".into()]));
        assert!(matches_filter(&i, "tag-key", &["Env".into()]));
        assert!(!matches_filter(&i, "nonsense", &["x".into()]));
    }

    #[test]
    fn instance_xml_is_escaped_and_carries_state_and_tags() {
        let x = instance_item(&inst());
        assert!(x.contains("<name>running</name>"));
        assert!(x.contains("web&lt;1&gt;"));
        assert!(x.contains("<key>Env</key><value>prod</value>"));
        assert!(x.contains("<instanceId>i-0123456789abcdef0</instanceId>"));
    }

    #[test]
    fn tags_from_tag_and_tag_specification_params() {
        let m = parse_form("Tag.1.Key=A&Tag.1.Value=1&TagSpecification.1.ResourceType=instance&TagSpecification.1.Tag.1.Key=Name&TagSpecification.1.Tag.1.Value=web&TagSpecification.2.ResourceType=volume&TagSpecification.2.Tag.1.Key=Skip&TagSpecification.2.Tag.1.Value=x");
        let t = parse_tags(&m);
        assert_eq!(t.get("A").map(String::as_str), Some("1"));
        assert_eq!(t.get("Name").map(String::as_str), Some("web"));
        assert!(!t.contains_key("Skip"), "volume tag specs are not applied to instances");
    }

    #[test]
    fn user_data_is_base64_text() {
        assert_eq!(decode_user_data("I2Nsb3VkLWNvbmZpZw==").unwrap(), "#cloud-config");
        assert!(decode_user_data("not base64!!").is_err());
        assert!(decode_user_data("/w==").is_err(), "0xFF is not UTF-8");
    }

    #[test]
    fn error_xml_has_code_message_and_request_id() {
        let e = Ec2Error::bad("InvalidParameterValue", "bad <x>");
        let x = error_xml(&e, "rid");
        assert!(x.contains("<Code>InvalidParameterValue</Code>"));
        assert!(x.contains("bad &lt;x&gt;"));
        assert!(x.contains("<RequestID>rid</RequestID>"));
    }
}
