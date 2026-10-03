// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SecurityBundleApplyResult {
    pub ok: bool,
    pub policy_dir: String,
    pub policies_written: usize,
    pub install_script_written: bool,
    pub tetragon_binary_found: bool,
    pub tetragon_install_attempted: bool,
    pub tetragon_service_active: bool,
    pub tetragon_export_timer_active: bool,
    pub operations: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SecurityFabricStatus {
    pub policy_dir: String,
    pub policy_files: Vec<String>,
    pub install_script_present: bool,
    pub tetragon_binary_found: bool,
    pub tetragon_service_active: bool,
    pub tetragon_export_timer_active: bool,
    pub export_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TetragonInstallSpec {
    pub export_url: String,
    pub host_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TetragonInstallResult {
    pub ok: bool,
    pub binary_installed: bool,
    pub service_active: bool,
    pub export_timer_active: bool,
    pub operations: Vec<String>,
    pub message: String,
}
