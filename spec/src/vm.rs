use serde::{Deserialize, Serialize};

use crate::error::SpecError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VirtualMachine {
    pub api_version: String,
    pub kind: String,
    pub metadata: VmMetadata,
    pub spec: VmSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VmMetadata {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VmSpec {
    #[serde(default)]
    pub profile: VmProfile,
    pub cpu: CpuSpec,
    pub memory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_ref: Option<String>,
    #[serde(default)]
    pub storage: Vec<StorageVolumeSpec>,
    #[serde(default)]
    pub network: Vec<NetworkAttachmentSpec>,
    #[serde(default)]
    pub ha: HaSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup: Option<BackupSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_init: Option<CloudInitSpec>,
    #[serde(default = "default_firmware")]
    pub firmware: String,
    #[serde(default = "default_graphics")]
    pub graphics: GraphicsSpec,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VmProfile {
    #[default]
    Development,
    Production,
    Lab,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CpuSpec {
    #[serde(default = "default_sockets")]
    pub sockets: u32,
    #[serde(default = "default_cores")]
    pub cores: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageVolumeSpec {
    pub name: String,
    pub size: String,
    #[serde(default = "default_storage_class")]
    pub class: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkAttachmentSpec {
    pub network: String,
    #[serde(default = "default_ip_mode")]
    pub ip_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firewall_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct HaSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_priority: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anti_affinity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloudInitSpec {
    #[serde(default = "default_cloud_user")]
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_pubkey: Option<String>,
}

fn default_cloud_user() -> String {
    "ubuntu".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackupSpec {
    pub policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphicsSpec {
    #[serde(default = "default_graphics_type")]
    pub r#type: String,
    #[serde(default = "default_graphics_listen")]
    pub listen: String,
}

fn default_firmware() -> String {
    "bios".into()
}
fn default_graphics() -> GraphicsSpec {
    GraphicsSpec {
        r#type: default_graphics_type(),
        listen: default_graphics_listen(),
    }
}
fn default_graphics_type() -> String {
    "both".into()
}
fn default_graphics_listen() -> String {
    "127.0.0.1".into()
}
fn default_sockets() -> u32 {
    1
}
fn default_cores() -> u32 {
    1
}
fn default_storage_class() -> String {
    "silver".into()
}
fn default_ip_mode() -> String {
    "dhcp".into()
}

impl VirtualMachine {
    pub fn new(name: impl Into<String>, memory: impl Into<String>) -> Self {
        Self {
            api_version: crate::API_VERSION.into(),
            kind: "VirtualMachine".into(),
            metadata: VmMetadata {
                name: name.into(),
                project: None,
                labels: None,
            },
            spec: VmSpec {
                profile: VmProfile::default(),
                cpu: CpuSpec {
                    sockets: 1,
                    cores: 1,
                },
                memory: memory.into(),
                template_ref: None,
                cloud_init: None,
                storage: vec![StorageVolumeSpec {
                    name: "root".into(),
                    size: "10Gi".into(),
                    class: "silver".into(),
                    source: None,
                }],
                network: vec![NetworkAttachmentSpec {
                    network: "default".into(),
                    ip_mode: "dhcp".into(),
                    firewall_profile: None,
                }],
                ha: HaSpec::default(),
                backup: None,
                firmware: default_firmware(),
                graphics: default_graphics(),
            },
        }
    }

    pub fn validate(&self) -> Result<(), SpecError> {
        validate_name(&self.metadata.name)?;
        if self.spec.cpu.sockets == 0 || self.spec.cpu.cores == 0 {
            return Err(SpecError::Validation(
                "cpu sockets and cores must be >= 1".into(),
            ));
        }
        if self.spec.cpu.sockets > 64 || self.spec.cpu.cores > 128 {
            return Err(SpecError::Validation(
                "cpu sockets must be <= 64 and cores must be <= 128".into(),
            ));
        }
        parse_memory_mib(&self.spec.memory)?;
        if self.spec.storage.is_empty() {
            return Err(SpecError::Validation(
                "at least one storage volume required".into(),
            ));
        }
        for vol in &self.spec.storage {
            validate_name(&vol.name)?;
            parse_size_gib(&vol.size)?;
        }
        if self.spec.network.is_empty() {
            return Err(SpecError::Validation(
                "at least one network attachment required".into(),
            ));
        }
        Ok(())
    }

    pub fn total_vcpus(&self) -> u32 {
        self.spec.cpu.sockets.saturating_mul(self.spec.cpu.cores)
    }

    pub fn memory_mib(&self) -> Result<u64, SpecError> {
        parse_memory_mib(&self.spec.memory)
    }

    pub fn root_disk_gib(&self) -> Result<u64, SpecError> {
        self.spec
            .storage
            .iter()
            .find(|v| v.name == "root")
            .map(|v| parse_size_gib(&v.size))
            .transpose()?
            .ok_or_else(|| SpecError::Validation("root volume required".into()))
    }
}

pub fn validate_name(name: &str) -> Result<(), SpecError> {
    if name.is_empty() || name.len() > 64 {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    if !name
        .chars()
        .next()
        .map(|c| c.is_ascii_alphanumeric())
        .unwrap_or(false)
    {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    Ok(())
}

/// Human-readable label for UI-only resources (application groups, blueprints).
pub fn validate_label(name: &str) -> Result<(), SpecError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    if name.contains('/') || name.contains('\\') || name.contains('<') || name.contains('>') {
        return Err(SpecError::InvalidName(name.to_string()));
    }
    Ok(())
}

pub fn parse_memory_mib(raw: &str) -> Result<u64, SpecError> {
    let s = raw.trim();
    if let Some(num) = s.strip_suffix("Gi") {
        let n: f64 = num
            .trim()
            .parse()
            .map_err(|e| SpecError::Memory(format!("{raw}: {e}")))?;
        return Ok((n * 1024.0).round() as u64);
    }
    if let Some(num) = s.strip_suffix("Mi") {
        let n: u64 = num
            .trim()
            .parse()
            .map_err(|e| SpecError::Memory(format!("{raw}: {e}")))?;
        return Ok(n);
    }
    if let Some(num) = s.strip_suffix("G") {
        let n: f64 = num
            .trim()
            .parse()
            .map_err(|e| SpecError::Memory(format!("{raw}: {e}")))?;
        return Ok((n * 1024.0).round() as u64);
    }
    s.parse::<u64>()
        .map_err(|e| SpecError::Memory(format!("{raw}: {e}")))
}

pub fn parse_size_gib(raw: &str) -> Result<u64, SpecError> {
    let s = raw.trim();
    if let Some(num) = s.strip_suffix("Gi") {
        return num
            .trim()
            .parse()
            .map_err(|e| SpecError::Memory(format!("{raw}: {e}")));
    }
    if let Some(num) = s.strip_suffix("G") {
        return num
            .trim()
            .parse()
            .map_err(|e| SpecError::Memory(format!("{raw}: {e}")));
    }
    s.parse::<u64>()
        .map_err(|e| SpecError::Memory(format!("{raw}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vm_validate_golden_path() {
        let vm = VirtualMachine::new("payroll-server", "32Gi");
        vm.validate().unwrap();
        assert_eq!(vm.total_vcpus(), 1);
        assert_eq!(vm.memory_mib().unwrap(), 32 * 1024);
    }

    #[test]
    fn parse_memory_units() {
        assert_eq!(parse_memory_mib("512Mi").unwrap(), 512);
        assert_eq!(parse_memory_mib("2Gi").unwrap(), 2048);
    }

    #[test]
    fn validate_label_allows_friendly_names() {
        assert!(validate_label("Finance Application").is_ok());
        assert!(validate_label("  Payroll & HR  ").is_ok());
        assert!(validate_label("").is_err());
        assert!(validate_label("bad/name").is_err());
    }
}
