// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Nova compute: list instances and lifecycle actions.

use std::collections::HashMap;

use openstack::compute::RebootType;
use openstack::Cloud;
use osauth::services::COMPUTE;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, effective_cloud_name_for_config, map_json_err, map_osauth_err};

/// Serializable instance row for API responses.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackInstance {
    pub id: String,
    pub name: String,
    pub status: String,
    pub power_state: String,
    pub flavor_id: Option<String>,
    pub flavor_name: Option<String>,
    pub availability_zone: String,
    pub project_id: Option<String>,
    pub key_name: Option<String>,
    pub image_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub ip_addresses: Vec<String>,
    pub security_groups: Vec<String>,
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackConnectionStatus {
    pub enabled: bool,
    pub configured: bool,
    pub cloud_name: String,
    pub connected: bool,
    /// True when Keystone identity auth works (minimal “live” for the UI).
    pub reachable: bool,
    pub keystone_reachable: bool,
    pub compute_reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_count: Option<usize>,
    pub glance_reachable: bool,
    pub neutron_reachable: bool,
    pub cinder_reachable: bool,
}

pub fn is_openstack_configured(cfg: &OpenStackConfig) -> bool {
    if !cfg.enabled {
        return false;
    }
    if !cfg.cloud_name.trim().is_empty() || !cfg.auth_url.trim().is_empty() {
        return true;
    }
    if cfg.use_env_auth {
        return true;
    }
    super::auth::resolve_clouds_yaml_path(cfg).is_some()
}

/// Connect to OpenStack using config (clouds.yaml cloud name, inline password, or OS_* env).
pub async fn connect_cloud(cfg: &OpenStackConfig) -> Result<Cloud, LibvirtError> {
    Ok(Cloud::from(connect_session(cfg).await?))
}

pub async fn test_connection(cfg: &OpenStackConfig) -> OpenStackConnectionStatus {
    let base = connection_status_skeleton(cfg);
    match connect_cloud(cfg).await {
        Ok(cloud) => {
            let servers = cloud.list_servers().await;
            let images = cloud.list_images().await;
            let compute_reachable = servers.is_ok();
            let glance_reachable = images.is_ok();
            let neutron_reachable = cloud.list_networks().await.is_ok();
            let cinder_reachable = super::quotas::probe_cinder_reachable(cfg).await;
            let instance_count = servers.as_ref().ok().map(|s| s.len());
            let image_count = images.as_ref().ok().map(|s| s.len());
            let mut error = None;
            if let Err(e) = servers {
                error = Some(format!("Nova: {}", map_openstack_err(e)));
            }
            if let Err(e) = images {
                let msg = format!("Glance: {}", map_openstack_err(e));
                error = Some(match error {
                    Some(prev) => format!("{prev}; {msg}"),
                    None => msg,
                });
            }
            OpenStackConnectionStatus {
                connected: true,
                reachable: true,
                keystone_reachable: true,
                compute_reachable,
                instance_count,
                image_count,
                glance_reachable,
                neutron_reachable,
                cinder_reachable,
                error,
                ..base
            }
        }
        Err(e) => OpenStackConnectionStatus {
            error: Some(e.to_string()),
            ..base
        },
    }
}

pub fn connection_status_skeleton(cfg: &OpenStackConfig) -> OpenStackConnectionStatus {
    let cloud_name = effective_cloud_name_for_config(cfg).unwrap_or_else(|| cfg.cloud_name.clone());
    OpenStackConnectionStatus {
        enabled: cfg.enabled,
        configured: is_openstack_configured(cfg),
        cloud_name,
        connected: false,
        reachable: false,
        keystone_reachable: false,
        compute_reachable: false,
        error: None,
        instance_count: None,
        image_count: None,
        glance_reachable: false,
        neutron_reachable: false,
        cinder_reachable: false,
    }
}

/// Query options for `list_instances`.
#[derive(Debug, Clone, Default)]
pub struct ListInstancesParams<'a> {
    pub search: Option<&'a str>,
    pub status: Option<&'a str>,
    /// When set with optional `marker`, Nova returns one page via `GET /servers/detail`.
    pub limit: Option<u32>,
    pub marker: Option<&'a str>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ListInstancesResult {
    pub instances: Vec<OpenStackInstance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_marker: Option<String>,
    #[serde(default)]
    pub has_more: bool,
    /// Set when the full project list is returned (no server-side `limit`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
    /// True when search mode hit the scan cap before filling the page.
    #[serde(default)]
    pub search_truncated: bool,
}

const DEFAULT_PAGE_LIMIT: u32 = 25;
const MAX_PAGE_LIMIT: u32 = 100;
const MAX_SEARCH_SCAN_PAGES: u32 = 20;
const MAX_SEARCH_MATCHES: usize = 500;

pub async fn list_instances(
    cfg: &OpenStackConfig,
    params: ListInstancesParams<'_>,
) -> Result<ListInstancesResult, LibvirtError> {
    if params.limit.is_none() && params.marker.is_none() {
        return list_instances_all(cfg, params.search, params.status).await;
    }
    let has_search = params.search.map(|s| !s.trim().is_empty()).unwrap_or(false);
    if has_search {
        return list_instances_search_paged(cfg, params).await;
    }
    list_instances_paged(cfg, params).await
}

async fn list_instances_all(
    cfg: &OpenStackConfig,
    search: Option<&str>,
    status_filter: Option<&str>,
) -> Result<ListInstancesResult, LibvirtError> {
    let session = connect_session(cfg).await?;
    let cloud = Cloud::from(session.clone());
    let summaries = cloud.list_servers().await.map_err(map_openstack_err)?;
    let search_l = search
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    let status_l = status_filter
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty());

    let flavor_cache = flavor_name_cache(&cloud).await;

    let mut out = Vec::with_capacity(summaries.len());
    for summary in summaries {
        let id = summary.id().to_string();
        let name = summary.name().to_string();
        if let Some(ref q) = search_l {
            if !name.to_lowercase().contains(q) && !id.to_lowercase().contains(q) {
                continue;
            }
        }
        let mut inst = fetch_nova_server(&session, &id).await?;
        enrich_instance_flavor_names(&mut inst, &flavor_cache);
        if let Some(ref want) = status_l {
            if !inst.status.eq_ignore_ascii_case(want) {
                continue;
            }
        }
        out.push(inst);
    }
    let total = out.len();
    Ok(ListInstancesResult {
        instances: out,
        next_marker: None,
        has_more: false,
        total: Some(total),
        search_truncated: false,
    })
}

async fn list_instances_search_paged(
    cfg: &OpenStackConfig,
    params: ListInstancesParams<'_>,
) -> Result<ListInstancesResult, LibvirtError> {
    let limit = params
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT) as usize;
    let search_l = params
        .search
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| LibvirtError::Invalid("search required".into()))?;
    let status_s = params
        .status
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty());

    let session = connect_session(cfg).await?;
    let cloud = Cloud::from(session.clone());
    let flavor_cache = flavor_name_cache(&cloud).await;

    let mut marker = params
        .marker
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    let mut out = Vec::new();
    let mut pages_fetched = 0u32;
    let mut nova_has_more = false;
    let mut last_nova_id: Option<String> = None;
    let mut total_scanned = 0usize;
    let mut search_truncated = false;

    while out.len() < limit
        && pages_fetched < MAX_SEARCH_SCAN_PAGES
        && total_scanned < MAX_SEARCH_MATCHES
    {
        let fetch_limit = MAX_PAGE_LIMIT;
        let limit_str = fetch_limit.to_string();
        let mut query: Vec<(String, String)> = vec![("limit".into(), limit_str)];
        if let Some(m) = &marker {
            query.push(("marker".into(), m.clone()));
        }
        if let Some(ref s) = status_s {
            query.push(("status".into(), s.clone()));
        }
        let query_refs: Vec<(&str, &str)> = query
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        let resp = session
            .get(COMPUTE, &["servers", "detail"])
            .query(&query_refs)
            .send()
            .await
            .map_err(map_osauth_err)?;
        let body: serde_json::Value = resp.json().await.map_err(map_json_err)?;
        let servers = body
            .get("servers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if servers.is_empty() {
            nova_has_more = false;
            break;
        }

        let page_count = servers.len();
        nova_has_more = page_count == fetch_limit as usize;
        last_nova_id = servers
            .last()
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_str())
            .map(String::from);

        for server in servers {
            total_scanned += 1;
            if total_scanned > MAX_SEARCH_MATCHES {
                search_truncated = true;
                break;
            }
            let mut inst = instance_from_nova_json(&server)?;
            if !inst.name.to_lowercase().contains(&search_l)
                && !inst.id.to_lowercase().contains(&search_l)
            {
                continue;
            }
            enrich_instance_flavor_names(&mut inst, &flavor_cache);
            out.push(inst);
            if out.len() >= limit {
                break;
            }
        }

        pages_fetched += 1;
        if !nova_has_more || out.len() >= limit || search_truncated {
            break;
        }
        marker = last_nova_id.clone();
    }

    if total_scanned >= MAX_SEARCH_MATCHES && nova_has_more {
        search_truncated = true;
    }

    let next_marker = if nova_has_more && !search_truncated {
        last_nova_id
    } else {
        None
    };

    Ok(ListInstancesResult {
        instances: out,
        next_marker,
        has_more: nova_has_more && !search_truncated,
        total: None,
        search_truncated,
    })
}

async fn list_instances_paged(
    cfg: &OpenStackConfig,
    params: ListInstancesParams<'_>,
) -> Result<ListInstancesResult, LibvirtError> {
    let limit = params
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT);
    let search_l = params
        .search
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    let status_s = params
        .status
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty());

    let session = connect_session(cfg).await?;
    let cloud = Cloud::from(session.clone());
    let flavor_cache = flavor_name_cache(&cloud).await;

    let mut marker = params
        .marker
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    let mut out = Vec::new();
    let mut pages_fetched = 0u32;
    let mut nova_has_more = false;
    let mut last_nova_id: Option<String> = None;

    while out.len() < limit as usize && pages_fetched < MAX_SEARCH_SCAN_PAGES {
        let limit_str = limit.to_string();
        let mut query: Vec<(String, String)> = vec![("limit".into(), limit_str)];
        if let Some(m) = &marker {
            query.push(("marker".into(), m.clone()));
        }
        if let Some(ref s) = status_s {
            query.push(("status".into(), s.clone()));
        }
        let query_refs: Vec<(&str, &str)> = query
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        let resp = session
            .get(COMPUTE, &["servers", "detail"])
            .query(&query_refs)
            .send()
            .await
            .map_err(map_osauth_err)?;
        let body: serde_json::Value = resp.json().await.map_err(map_json_err)?;
        let servers = body
            .get("servers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if servers.is_empty() {
            nova_has_more = false;
            break;
        }

        let page_count = servers.len();
        nova_has_more = page_count == limit as usize;
        last_nova_id = servers
            .last()
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_str())
            .map(String::from);

        for server in servers {
            let mut inst = instance_from_nova_json(&server)?;
            if let Some(ref q) = search_l {
                if !inst.name.to_lowercase().contains(q) && !inst.id.to_lowercase().contains(q) {
                    continue;
                }
            }
            enrich_instance_flavor_names(&mut inst, &flavor_cache);
            out.push(inst);
            if out.len() >= limit as usize {
                break;
            }
        }

        pages_fetched += 1;
        if search_l.is_none() {
            break;
        }
        if !nova_has_more {
            break;
        }
        marker = last_nova_id.clone();
    }

    let next_marker = if nova_has_more { last_nova_id } else { None };

    Ok(ListInstancesResult {
        instances: out,
        next_marker,
        has_more: nova_has_more,
        total: None,
        search_truncated: false,
    })
}

fn enrich_instance_flavor_names(inst: &mut OpenStackInstance, cache: &HashMap<String, String>) {
    if let Some(ref fid) = inst.flavor_id {
        if let Some(fname) = cache.get(fid) {
            inst.flavor_name = Some(fname.clone());
        }
    }
}

pub async fn get_instance(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackInstance, LibvirtError> {
    let session = connect_session(cfg).await?;
    fetch_nova_server(&session, id).await
}

async fn fetch_nova_server(
    session: &osauth::Session,
    id: &str,
) -> Result<OpenStackInstance, LibvirtError> {
    let resp = session
        .get(COMPUTE, &["servers", id.trim()])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: serde_json::Value = resp.json().await.map_err(map_json_err)?;
    let server = body
        .get("server")
        .ok_or_else(|| LibvirtError::Invalid("Nova response missing server".into()))?;
    instance_from_nova_json(server)
}

pub async fn start_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let mut server = cloud.get_server(id).await.map_err(map_openstack_err)?;
    server.start().await.map_err(map_openstack_err)?;
    Ok(())
}

pub async fn stop_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let mut server = cloud.get_server(id).await.map_err(map_openstack_err)?;
    server.stop().await.map_err(map_openstack_err)?;
    Ok(())
}

pub async fn reboot_instance(
    cfg: &OpenStackConfig,
    id: &str,
    soft: bool,
) -> Result<(), LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let mut server = cloud.get_server(id).await.map_err(map_openstack_err)?;
    let reboot_type = if soft {
        RebootType::Soft
    } else {
        RebootType::Hard
    };
    server
        .reboot(reboot_type)
        .await
        .map_err(map_openstack_err)?;
    Ok(())
}

pub async fn delete_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let cloud = connect_cloud(cfg).await?;
    let server = cloud.get_server(id).await.map_err(map_openstack_err)?;
    server.delete().await.map_err(map_openstack_err)?;
    Ok(())
}

pub async fn force_delete_instance(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    use super::auth::{connect_session, map_osauth_err};
    use osauth::services::COMPUTE;
    let session = connect_session(cfg).await?;
    session
        .post(COMPUTE, &["servers", id.trim(), "action"])
        .json(&serde_json::json!({ "forceDelete": null }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

fn instance_from_nova_json(server: &serde_json::Value) -> Result<OpenStackInstance, LibvirtError> {
    let id = server
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("Nova server missing id".into()));
    }
    let name = server
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let status = server
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let power_state = server
        .get("OS-EXT-STS:power_state")
        .and_then(|v| v.as_u64())
        .map(power_state_label)
        .unwrap_or_else(|| "unknown".to_string());

    let mut ips = Vec::new();
    if let Some(addrs) = server.get("addresses").and_then(|v| v.as_object()) {
        for arr in addrs.values() {
            if let Some(arr) = arr.as_array() {
                for a in arr {
                    if let Some(ip) = a.get("addr").and_then(|v| v.as_str()) {
                        ips.push(ip.to_string());
                    }
                }
            }
        }
    }

    let mut security_groups = Vec::new();
    if let Some(sgs) = server.get("security_groups").and_then(|v| v.as_array()) {
        for sg in sgs {
            if let Some(name) = sg.get("name").and_then(|v| v.as_str()) {
                let t = name.trim();
                if !t.is_empty() {
                    security_groups.push(t.to_string());
                }
            }
        }
    }

    let flavor_id = server
        .get("flavor")
        .and_then(|f| f.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let availability_zone = server
        .get("OS-EXT-AZ:availability_zone")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let key_name = server
        .get("key_name")
        .and_then(|v| v.as_str())
        .map(String::from);
    let image_id = server
        .get("image")
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = server
        .get("created")
        .and_then(|v| v.as_str())
        .map(String::from);
    let updated_at = server
        .get("updated")
        .and_then(|v| v.as_str())
        .map(String::from);

    let mut metadata = HashMap::new();
    if let Some(m) = server.get("metadata").and_then(|v| v.as_object()) {
        for (k, v) in m {
            if let Some(s) = v.as_str() {
                metadata.insert(k.clone(), s.to_string());
            }
        }
    }

    let locked = server
        .get("locked")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let project_id = server
        .get("tenant_id")
        .or_else(|| server.get("project_id"))
        .and_then(|v| v.as_str())
        .map(String::from);

    Ok(OpenStackInstance {
        id,
        name,
        status,
        power_state,
        flavor_id,
        flavor_name: None,
        availability_zone,
        project_id,
        key_name,
        image_id,
        created_at,
        updated_at,
        ip_addresses: ips,
        security_groups,
        metadata,
        locked,
    })
}

fn power_state_label(code: u64) -> String {
    match code {
        0 => "nostate",
        1 => "running",
        3 => "paused",
        4 => "shutdown",
        6 => "crashed",
        7 => "suspended",
        _ => "unknown",
    }
    .to_string()
}

pub(crate) async fn flavor_name_cache(cloud: &Cloud) -> HashMap<String, String> {
    let mut cache = HashMap::new();
    if let Ok(summaries) = cloud.list_flavors().await {
        for summary in summaries {
            if let Ok(flavor) = summary.details().await {
                cache.insert(flavor.id().clone(), flavor.name().clone());
            }
        }
    }
    cache
}

pub(crate) use super::auth::map_osauth_err as map_openstack_err;
