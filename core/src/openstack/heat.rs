// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Heat orchestration stacks (list, get, create, update, delete, resources, events, template).

use osauth::services::{GenericService, VersionSelector};
use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

const ORCHESTRATION: GenericService = GenericService::new("orchestration", VersionSelector::Any);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackHeatOutput {
    pub output_key: String,
    pub output_value: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackHeatResource {
    pub logical_resource_id: String,
    pub resource_name: String,
    pub resource_status: String,
    pub resource_type: String,
    pub physical_resource_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackHeatEvent {
    pub event_time: Option<String>,
    pub resource_name: String,
    pub resource_status: Option<String>,
    pub resource_status_reason: Option<String>,
    pub resource_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackHeatStack {
    pub id: String,
    pub stack_name: String,
    pub stack_status: String,
    pub stack_status_reason: Option<String>,
    pub creation_time: Option<String>,
    pub updated_time: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub timeout_mins: Option<u32>,
    #[serde(default)]
    pub parameters: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub outputs: Vec<OpenStackHeatOutput>,
}

#[derive(Deserialize)]
struct StackJson {
    id: String,
    stack_name: String,
    stack_status: String,
    #[serde(default)]
    stack_status_reason: Option<String>,
    #[serde(default)]
    creation_time: Option<String>,
    #[serde(default)]
    updated_time: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    timeout_mins: Option<u32>,
    #[serde(default)]
    parameters: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    outputs: Vec<OutputJson>,
}

#[derive(Deserialize)]
struct OutputJson {
    output_key: String,
    #[serde(default)]
    output_value: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

fn stack_from_json(s: StackJson) -> OpenStackHeatStack {
    OpenStackHeatStack {
        id: s.id,
        stack_name: s.stack_name,
        stack_status: s.stack_status,
        stack_status_reason: s.stack_status_reason,
        creation_time: s.creation_time,
        updated_time: s.updated_time,
        description: s.description,
        timeout_mins: s.timeout_mins,
        parameters: s.parameters,
        outputs: s
            .outputs
            .into_iter()
            .map(|o| OpenStackHeatOutput {
                output_key: o.output_key,
                output_value: o.output_value,
                description: o.description,
            })
            .collect(),
    }
}

pub async fn probe_heat_reachable(cfg: &OpenStackConfig) -> bool {
    let Ok(session) = connect_session(cfg).await else {
        return false;
    };
    session
        .get(ORCHESTRATION, &["stacks"])
        .query(&[("limit", "1")])
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn list_heat_stacks(cfg: &OpenStackConfig) -> Result<Vec<OpenStackHeatStack>, LibvirtError> {
    if !probe_heat_reachable(cfg).await {
        return Ok(Vec::new());
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        stacks: Vec<StackJson>,
    }
    let resp = session
        .get(ORCHESTRATION, &["stacks"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body.stacks.into_iter().map(stack_from_json).collect();
    out.sort_by(|a, b| a.stack_name.cmp(&b.stack_name));
    Ok(out)
}

pub async fn get_heat_stack(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
) -> Result<OpenStackHeatStack, LibvirtError> {
    let name = stack_name.trim();
    let id = stack_id.trim();
    if name.is_empty() || id.is_empty() {
        return Err(LibvirtError::Invalid("stack_name and stack_id are required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        stack: StackJson,
    }
    let resp = session
        .get(ORCHESTRATION, &["stacks", name, id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(stack_from_json(body.stack))
}

pub async fn list_heat_stack_resources(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
) -> Result<Vec<OpenStackHeatResource>, LibvirtError> {
    let (name, id) = heat_stack_ids(stack_name, stack_id)?;
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        resources: Vec<ResourceJson>,
    }
    #[derive(Deserialize)]
    struct ResourceJson {
        logical_resource_id: String,
        resource_name: String,
        resource_status: String,
        resource_type: String,
        #[serde(default)]
        physical_resource_id: Option<String>,
    }
    let resp = session
        .get(ORCHESTRATION, &["stacks", name, id, "resources"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .resources
        .into_iter()
        .map(|r| OpenStackHeatResource {
            logical_resource_id: r.logical_resource_id,
            resource_name: r.resource_name,
            resource_status: r.resource_status,
            resource_type: r.resource_type,
            physical_resource_id: r.physical_resource_id,
        })
        .collect())
}

pub async fn list_heat_stack_events(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
) -> Result<Vec<OpenStackHeatEvent>, LibvirtError> {
    let (name, id) = heat_stack_ids(stack_name, stack_id)?;
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        events: Vec<EventJson>,
    }
    #[derive(Deserialize)]
    struct EventJson {
        #[serde(default)]
        event_time: Option<String>,
        resource_name: String,
        #[serde(default)]
        resource_status: Option<String>,
        #[serde(default)]
        resource_status_reason: Option<String>,
        #[serde(default)]
        resource_type: Option<String>,
    }
    let resp = session
        .get(ORCHESTRATION, &["stacks", name, id, "events"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .events
        .into_iter()
        .map(|e| OpenStackHeatEvent {
            event_time: e.event_time,
            resource_name: e.resource_name,
            resource_status: e.resource_status,
            resource_status_reason: e.resource_status_reason,
            resource_type: e.resource_type,
        })
        .collect())
}

pub async fn get_heat_stack_template(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
) -> Result<String, LibvirtError> {
    let (name, id) = heat_stack_ids(stack_name, stack_id)?;
    let session = connect_session(cfg).await?;
    let resp = session
        .get(ORCHESTRATION, &["stacks", name, id, "template"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: serde_json::Value = resp.json().await.map_err(map_json_err)?;
    if let Some(t) = body.get("template").and_then(|v| v.as_str()) {
        return Ok(t.to_string());
    }
    if let Some(s) = body.as_str() {
        return Ok(s.to_string());
    }
    Err(LibvirtError::Invalid("Heat template response missing template body".into()))
}

fn heat_stack_ids<'a>(stack_name: &'a str, stack_id: &'a str) -> Result<(&'a str, &'a str), LibvirtError> {
    let name = stack_name.trim();
    let id = stack_id.trim();
    if name.is_empty() || id.is_empty() {
        return Err(LibvirtError::Invalid("stack_name and stack_id are required".into()));
    }
    Ok((name, id))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateHeatStackRequest {
    pub stack_name: String,
    pub template_body: String,
    #[serde(default)]
    pub parameters: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub timeout_mins: Option<u32>,
}

pub async fn create_heat_stack(
    cfg: &OpenStackConfig,
    req: &CreateHeatStackRequest,
) -> Result<OpenStackHeatStack, LibvirtError> {
    let name = req.stack_name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("stack_name is required".into()));
    }
    if req.template_body.trim().is_empty() {
        return Err(LibvirtError::Invalid("template_body is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut body = serde_json::json!({
        "stack_name": name,
        "template": req.template_body.trim(),
    });
    if !req.parameters.is_empty() {
        body["parameters"] = serde_json::Value::Object(req.parameters.clone());
    }
    if let Some(t) = req.timeout_mins {
        body["timeout_mins"] = t.into();
    }
    let resp = session
        .post(ORCHESTRATION, &["stacks"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let out: serde_json::Value = resp.json().await.map_err(map_json_err)?;
    let stack = out.get("stack").ok_or_else(|| {
        LibvirtError::Invalid("Heat create response missing stack".into())
    })?;
    let parsed: StackJson = serde_json::from_value(stack.clone())
        .map_err(|e| LibvirtError::Invalid(format!("Heat create response parse: {e}")))?;
    Ok(stack_from_json(parsed))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateHeatStackRequest {
    #[serde(default)]
    pub template_body: Option<String>,
    #[serde(default)]
    pub parameters: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    pub timeout_mins: Option<u32>,
}

pub async fn update_heat_stack(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
    req: &UpdateHeatStackRequest,
) -> Result<OpenStackHeatStack, LibvirtError> {
    let (name, id) = heat_stack_ids(stack_name, stack_id)?;
    if req.template_body.as_ref().is_none_or(|t| t.trim().is_empty())
        && req.parameters.is_none()
        && req.timeout_mins.is_none()
    {
        return Err(LibvirtError::Invalid(
            "at least one of template_body, parameters, or timeout_mins is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let mut body = serde_json::Map::new();
    if let Some(ref t) = req.template_body {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            body.insert("template".into(), trimmed.into());
        }
    }
    if let Some(ref p) = req.parameters {
        body.insert("parameters".into(), serde_json::Value::Object(p.clone()));
    }
    if let Some(t) = req.timeout_mins {
        body.insert("timeout_mins".into(), t.into());
    }
    let resp = session
        .request(ORCHESTRATION, Method::PATCH, &["stacks", name, id])
        .json(&serde_json::Value::Object(body))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let out: serde_json::Value = resp.json().await.map_err(map_json_err)?;
    let stack = out.get("stack").ok_or_else(|| {
        LibvirtError::Invalid("Heat update response missing stack".into())
    })?;
    let parsed: StackJson = serde_json::from_value(stack.clone())
        .map_err(|e| LibvirtError::Invalid(format!("Heat create response parse: {e}")))?;
    Ok(stack_from_json(parsed))
}

pub async fn delete_heat_stack(
    cfg: &OpenStackConfig,
    stack_name: &str,
    stack_id: &str,
) -> Result<(), LibvirtError> {
    let name = stack_name.trim();
    let id = stack_id.trim();
    if name.is_empty() || id.is_empty() {
        return Err(LibvirtError::Invalid("stack_name and stack_id are required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(ORCHESTRATION, &["stacks", name, id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}
