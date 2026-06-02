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
}

impl Default for ControllerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 5093,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://machina:machina@127.0.0.1:5432/machina".into()),
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
            controller_id: std::env::var("MACHINA_CONTROLLER_ID").unwrap_or_else(|_| {
                format!("ctrl-{}", &uuid::Uuid::new_v4().to_string()[..8])
            }),
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
        }
    }
}
