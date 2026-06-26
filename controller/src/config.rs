// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ControllerConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub nats_url: Option<String>,
    pub default_agent_addr: String,
    pub default_libvirt_uri: String,
    pub disk_image_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub admin_user: String,
    pub admin_password: String,
    pub jwt_secret: String,
    pub controller_id: String,
    pub public_base_url: String,
    pub web_base_url: String,
    pub guestkit_enabled: bool,
    pub guestkit_worker_url: String,
    pub guestkit_insecure_tls: bool,
    pub packetwolf_enabled: bool,
    pub packetwolf_base_url: String,
    pub packetwolf_api_key: Option<String>,
    pub packetwolf_insecure_tls: bool,
    /// Co-located machina-daemon base URL for KubeVirt inventory sync.
    pub daemon_base_url: String,
    /// ConsoleHub / Guacamole (optional protocol gateway on hypervisors).
    pub guacamole_enabled: bool,
    pub guacamole_json_secret_hex: String,
    pub guacamole_base_url: String,
    pub guacamole_fetch_token: bool,
    pub consolehub_session_ttl_secs: u64,
    pub consolehub_proxy_prefix: String,
    /// Require approval workflow for production VM console (Phase 2/5).
    pub consolehub_require_approval: bool,
    /// Enable session recording metadata (Phase 2).
    pub consolehub_recording_enabled: bool,
    /// Directory for ConsoleHub session replay files (`.webm` per session id).
    pub consolehub_recording_dir: PathBuf,
    /// Require OIDC/SAML federation before opening production consoles (Phase 5).
    pub consolehub_require_oidc: bool,
    /// Hermes Launchpad API (Kubernetes app catalog + gateway).
    pub hermes_api_base: String,
    pub hermes_public_base: String,
    pub hermes_path_prefix: String,
}

impl Default for ControllerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 5093,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:///var/lib/machina/controller.db".into()),
            nats_url: std::env::var("NATS_URL").ok(),
            default_agent_addr: std::env::var("MACHINA_AGENT_ADDR")
                .unwrap_or_else(|_| "http://127.0.0.1:50051".into()),
            default_libvirt_uri: std::env::var("MACHINA_LIBVIRT_URI")
                .unwrap_or_else(|_| "qemu:///system".into()),
            disk_image_dir: PathBuf::from("/var/lib/libvirt/images"),
            backup_dir: PathBuf::from("/var/lib/machina/backups"),
            admin_user: "admin".into(),
            admin_password: "admin".into(),
            jwt_secret: std::env::var("MACHINA_JWT_SECRET")
                .unwrap_or_else(|_| "machina-dev-jwt-secret-change-me".into()),
            controller_id: std::env::var("MACHINA_CONTROLLER_ID")
                .unwrap_or_else(|_| format!("ctrl-{}", &uuid::Uuid::new_v4().to_string()[..8])),
            public_base_url: std::env::var("MACHINA_PUBLIC_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5093".into()),
            web_base_url: std::env::var("MACHINA_WEB_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5173".into()),
            guestkit_enabled: std::env::var("GUESTKIT_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(true),
            guestkit_worker_url: std::env::var("GUESTKIT_WORKER_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
            guestkit_insecure_tls: std::env::var("GUESTKIT_INSECURE_TLS")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(true),
            packetwolf_enabled: std::env::var("PACKETWOLF_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            packetwolf_base_url: std::env::var("PACKETWOLF_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:9091".into()),
            packetwolf_api_key: std::env::var("PACKETWOLF_API_KEY").ok(),
            packetwolf_insecure_tls: std::env::var("PACKETWOLF_INSECURE_TLS")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(true),
            daemon_base_url: std::env::var("MACHINA_DAEMON_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5092".into()),
            guacamole_enabled: std::env::var("GUACAMOLE_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or_else(|_| {
                    std::env::var("GUACAMOLE_JSON_SECRET_HEX")
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false)
                }),
            guacamole_json_secret_hex: std::env::var("GUACAMOLE_JSON_SECRET_HEX")
                .unwrap_or_default(),
            guacamole_base_url: std::env::var("GUACAMOLE_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8081/guacamole".into()),
            guacamole_fetch_token: std::env::var("GUACAMOLE_FETCH_TOKEN")
                .map(|v| !matches!(v.to_lowercase().as_str(), "0" | "false" | "no"))
                .unwrap_or(true),
            consolehub_session_ttl_secs: std::env::var("CONSOLEHUB_SESSION_TTL_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(600),
            consolehub_proxy_prefix: std::env::var("CONSOLEHUB_PROXY_PREFIX")
                .unwrap_or_else(|_| "/consolehub/guacamole".into()),
            consolehub_require_approval: std::env::var("CONSOLEHUB_REQUIRE_APPROVAL")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            consolehub_recording_enabled: std::env::var("CONSOLEHUB_RECORDING_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            consolehub_recording_dir: std::env::var("CONSOLEHUB_RECORDING_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/var/lib/machina/console-recordings")),
            consolehub_require_oidc: std::env::var("CONSOLEHUB_REQUIRE_OIDC")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            hermes_api_base: std::env::var("HERMES_API_BASE")
                .unwrap_or_else(|_| "http://127.0.0.1:31847/api/v1".into()),
            hermes_public_base: std::env::var("HERMES_PUBLIC_BASE")
                .unwrap_or_else(|_| "http://127.0.0.1:31847".into()),
            hermes_path_prefix: std::env::var("HERMES_PATH_PREFIX")
                .unwrap_or_else(|_| "/launchpad".into()),
        }
    }
}
