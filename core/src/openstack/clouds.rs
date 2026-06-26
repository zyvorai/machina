// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! clouds.yaml discovery for multi-cloud UI.

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{default_cloud_from_yaml, effective_cloud_name, resolve_clouds_yaml_path};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackCloudEntry {
    pub name: String,
    pub active: bool,
}

pub fn list_configured_clouds(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackCloudEntry>, LibvirtError> {
    let path = resolve_clouds_yaml_path(cfg).ok_or_else(|| {
        LibvirtError::Invalid("no clouds.yaml found — set clouds_yaml_path in [openstack]".into())
    })?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| LibvirtError::Operation(e.to_string()))?;
    let active = effective_cloud_name(cfg).unwrap_or_default();
    let mut names = Vec::new();
    let mut in_clouds = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed == "clouds:" {
            in_clouds = true;
            continue;
        }
        if !in_clouds {
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") {
            if let Some(name) = trimmed.strip_suffix(':') {
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
        }
    }
    if names.is_empty() {
        if let Some(one) = default_cloud_from_yaml(&path) {
            names.push(one);
        }
    }
    Ok(names
        .into_iter()
        .map(|name| OpenStackCloudEntry {
            active: name == active,
            name,
        })
        .collect())
}
