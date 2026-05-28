// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Keystone session for Nova, Glance, and Neutron API calls.

use std::time::Duration;

use openstack::{auth, IdOrName};
use osauth::Session;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

/// Expand `~` and return a clouds.yaml path if the file exists.
pub fn resolve_clouds_yaml_path(cfg: &OpenStackConfig) -> Option<std::path::PathBuf> {
    let mut candidates: Vec<String> = Vec::new();
    if !cfg.clouds_yaml_path.trim().is_empty() {
        candidates.push(expand_tilde(cfg.clouds_yaml_path.trim()));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{home}/.config/openstack/clouds.yaml"));
    }
    candidates.push("/etc/openstack/clouds.yaml".into());
    for path in candidates {
        let p = std::path::PathBuf::from(&path);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// First cloud entry in clouds.yaml when `cloud_name` is unset.
pub fn default_cloud_from_yaml(path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
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
                if !name.is_empty() && name != "clouds" {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

pub fn effective_cloud_name(cfg: &OpenStackConfig) -> Option<String> {
    if !cfg.cloud_name.trim().is_empty() {
        return Some(cfg.cloud_name.trim().to_string());
    }
    if !cfg.default_os_cloud.trim().is_empty() {
        return Some(cfg.default_os_cloud.trim().to_string());
    }
    if let Some(path) = resolve_clouds_yaml_path(cfg) {
        return default_cloud_from_yaml(&path);
    }
    None
}

pub fn resolve_auth_url(cfg: &OpenStackConfig) -> Option<String> {
    if !cfg.auth_url.trim().is_empty() {
        return Some(cfg.auth_url.trim().to_string());
    }
    let path = resolve_clouds_yaml_path(cfg)?;
    let cloud = effective_cloud_name(cfg)?;
    let content = std::fs::read_to_string(path).ok()?;
    let mut in_cloud = false;
    let mut in_auth = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") {
            in_cloud = trimmed == format!("{cloud}:");
            in_auth = false;
            continue;
        }
        if !in_cloud {
            continue;
        }
        if trimmed == "auth:" {
            in_auth = true;
            continue;
        }
        if in_auth && line.starts_with("      ") {
            if let Some(val) = trimmed.strip_prefix("auth_url:") {
                let url = val.trim().trim_matches('"');
                if !url.is_empty() {
                    return Some(url.to_string());
                }
            }
        } else if in_auth && line.starts_with("    ") && !line.starts_with("      ") {
            in_auth = false;
        }
    }
    None
}

pub fn effective_cloud_name_for_config(cfg: &OpenStackConfig) -> Option<String> {
    effective_cloud_name(cfg)
}

fn apply_openstack_env(cfg: &OpenStackConfig) {
    if let Some(path) = resolve_clouds_yaml_path(cfg) {
        std::env::set_var(
            "OS_CLIENT_CONFIG_FILE",
            path.to_string_lossy().as_ref(),
        );
    }
    if !cfg.region.trim().is_empty() {
        std::env::set_var("OS_REGION_NAME", cfg.region.trim());
    }
}

/// Connect to OpenStack and return an authenticated API session.
pub async fn connect_session(cfg: &OpenStackConfig) -> Result<Session, LibvirtError> {
    if !cfg.enabled {
        return Err(LibvirtError::Invalid(
            "OpenStack management is disabled; set [openstack] enabled = true in machina config".into(),
        ));
    }

    let has_cloud = effective_cloud_name(cfg).is_some();
    if has_cloud && !cfg.auth_url.trim().is_empty() {
        return Err(LibvirtError::Invalid(
            "set either cloud_name/clouds.yaml or inline auth_url in [openstack], not both".into(),
        ));
    }
    if !cfg.auth_url.trim().is_empty() {
        if cfg.username.trim().is_empty() || cfg.password.trim().is_empty() {
            return Err(LibvirtError::Invalid(
                "auth_url requires username and password in [openstack] config".into(),
            ));
        }
        if cfg.project_name.trim().is_empty() {
            return Err(LibvirtError::Invalid(
                "auth_url requires project_name (tenant) in [openstack] config".into(),
            ));
        }
    }

    apply_openstack_env(cfg);

    let timeout = Duration::from_secs(cfg.connect_timeout_secs.max(5));

    let connect = async {
        if let Some(cloud) = effective_cloud_name(cfg) {
            return Session::from_config(&cloud).await;
        }

        if !cfg.auth_url.trim().is_empty() {
            let user = cfg.username.trim();
            let pass = cfg.password.trim();
            let project = cfg.project_name.trim();
            let domain = if cfg.domain_name.trim().is_empty() {
                "Default"
            } else {
                cfg.domain_name.trim()
            };
            let scope = auth::Scope::Project {
                project: IdOrName::from_name(project),
                domain: Some(IdOrName::from_name(domain)),
            };
            let auth = auth::Password::new(cfg.auth_url.trim(), user, pass, domain)?
                .with_scope(scope);
            return Session::new(auth).await;
        }

        if cfg.use_env_auth {
            Session::from_env().await
        } else {
            Err(osauth::Error::new(
                osauth::ErrorKind::InvalidInput,
                "OpenStack is not configured",
            ))
        }
    };

    tokio::time::timeout(timeout, connect)
        .await
        .map_err(|_| {
            LibvirtError::Operation(format!(
                "OpenStack connection timed out after {}s",
                timeout.as_secs()
            ))
        })?
        .map_err(map_osauth_err)
}

/// Keystone catalog on Packstack registers identity at `:5000` without `/v3`, and root
/// version discovery returns `{"versions":{"values":[...]}}` which osauth cannot parse.
/// Pin the identity API root from `auth_url` (always `/v3`) before any identity calls.
pub(crate) async fn connect_identity_session(cfg: &OpenStackConfig) -> Result<Session, LibvirtError> {
    use osauth::services::{GenericService, VersionSelector};

    const IDENTITY: GenericService = GenericService::new("identity", VersionSelector::Major(3));

    let mut session = connect_session(cfg).await?;
    if let Some(root) = identity_api_root(cfg) {
        session.set_endpoint_override(IDENTITY, root);
    }
    Ok(session)
}

fn identity_api_root(cfg: &OpenStackConfig) -> Option<reqwest::Url> {
    if let Some(auth_url) = resolve_auth_url(cfg) {
        if let Ok(mut url) = reqwest::Url::parse(auth_url.trim()) {
            normalize_identity_url(&mut url);
            return Some(url);
        }
    }
    if let Ok(auth) = std::env::var("OS_AUTH_URL") {
        if let Ok(mut url) = reqwest::Url::parse(auth.trim()) {
            normalize_identity_url(&mut url);
            return Some(url);
        }
    }
    None
}

fn normalize_identity_url(url: &mut reqwest::Url) {
    if !url.path().contains("/v3") {
        url.set_path("/v3/");
    }
}

pub(crate) fn map_json_err(e: reqwest::Error) -> LibvirtError {
    let mut msg = e.to_string();
    if msg.len() > 600 {
        msg.truncate(600);
        msg.push('…');
    }
    LibvirtError::Operation(msg)
}

pub(crate) fn map_osauth_err(e: osauth::Error) -> LibvirtError {
    let mut msg = e.to_string();
    if let Some(first) = msg.lines().next() {
        if msg.lines().count() > 4 {
            msg = first.to_string();
        }
    }
    if msg.len() > 600 {
        msg.truncate(600);
        msg.push('…');
    }
    LibvirtError::Operation(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OpenStackConfig;

    #[test]
    fn resolve_clouds_yaml_uses_configured_path() {
        let dir = std::env::temp_dir().join(format!("machina-os-yaml-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let yaml = dir.join("clouds.yaml");
        std::fs::write(&yaml, "clouds:\n  packstack:\n").expect("write yaml");
        let mut cfg = OpenStackConfig::default();
        cfg.clouds_yaml_path = yaml.to_string_lossy().into_owned();
        assert_eq!(resolve_clouds_yaml_path(&cfg).as_deref(), Some(yaml.as_path()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_cloud_from_yaml_reads_first_cloud() {
        let dir = std::env::temp_dir().join(format!("machina-os-cloud-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let yaml = dir.join("clouds.yaml");
        std::fs::write(
            &yaml,
            "clouds:\n  packstack:\n    auth:\n      auth_url: http://127.0.0.1:5000/v3\n  other:\n",
        )
        .expect("write yaml");
        assert_eq!(default_cloud_from_yaml(&yaml).as_deref(), Some("packstack"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn effective_cloud_name_prefers_config() {
        let mut cfg = OpenStackConfig::default();
        cfg.cloud_name = "explicit".into();
        cfg.default_os_cloud = "fallback".into();
        assert_eq!(effective_cloud_name_for_config(&cfg).as_deref(), Some("explicit"));
    }

    #[test]
    fn effective_cloud_name_from_yaml_when_unset() {
        let dir = std::env::temp_dir().join(format!("machina-os-eff-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let yaml = dir.join("clouds.yaml");
        std::fs::write(&yaml, "clouds:\n  fromfile:\n").expect("write yaml");
        let mut cfg = OpenStackConfig::default();
        cfg.clouds_yaml_path = yaml.to_string_lossy().into_owned();
        assert_eq!(effective_cloud_name_for_config(&cfg).as_deref(), Some("fromfile"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identity_api_root_appends_v3_when_missing() {
        let mut cfg = OpenStackConfig::default();
        cfg.auth_url = "http://127.0.0.1:5000".into();
        let url = identity_api_root(&cfg).expect("url");
        assert_eq!(url.as_str(), "http://127.0.0.1:5000/v3/");
    }

    #[test]
    fn identity_api_root_keeps_existing_v3_path() {
        let mut cfg = OpenStackConfig::default();
        cfg.auth_url = "http://127.0.0.1:5000/v3".into();
        let url = identity_api_root(&cfg).expect("url");
        assert_eq!(url.as_str(), "http://127.0.0.1:5000/v3");
    }
}
